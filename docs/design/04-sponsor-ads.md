# Student Hub design: sponsors, ads, pay-per-click and analytics

I read the lims-sotoy transaction, error and rate-limit modules to match their patterns. I did not write any files, run anything or connect to the VPS.

## 1. Decisions

1. **Sponsor lifecycle:** PENDING → APPROVED ⇄ SUSPENDED (PENDING can also go → SUSPENDED).
   - A PENDING sponsor can log in, edit contact details, upload banners and create or edit DRAFT ads. It cannot submit ads or top-ups.
   - A SUSPENDED sponsor is read-only: analytics, ledger and history.
   - Why: onboarding can start before approval, and a paying-for-nothing path never opens.
2. **Suspension never changes ad rows.** Serving and click billing check `sponsor.status` at runtime, so reinstating restores everything with nothing to migrate.
3. **There is no stored ENDED status (deviation from the task text).** "Ended" is derived from `endAt <= now` by `deriveAdDisplayStatus`.
   - Why: no cron is needed, it cannot drift, and extending `endAt` brings the ad back to life with no review.
   - UI "Aktif" = derived `LIVE`. Every other derived state is "Nonaktif".
4. **CPC is snapshotted at SUBMIT, not at approval (deviation from the task text; matches the schema comment).**
   - Why: the sponsor must see and agree to the price it will be charged. A snapshot taken at approval could charge a price the sponsor never saw.
   - Re-submitting after a content edit re-snapshots the price. The `cpcAmount` on a DRAFT is only an estimate (the current default).
5. **Re-review rule:** changes to the image, targetUrl, linkType, targetScope or targets on an APPROVED or PAUSED ad → PENDING_REVIEW, and the ad stops serving until it is approved again. Changes to the title or schedule need no re-review.
   - Why: the risky content is always reviewed. There is no revision table (YAGNI).
6. **An ad in PENDING_REVIEW cannot be edited** (409: withdraw first). Approve and reject compare-and-set on `status=PENDING_REVIEW AND submittedAt=<the value the reviewer saw>`.
   - Why: the reviewer approves exactly the version they looked at.
7. **Billable click = at most 1 CHARGED click per (student, ad, WIB calendar day)**, enforced by `@@unique([adId,userId,billableDate])`.
   - Why: the database enforces it, and a rolling window cannot be expressed as a unique key.
8. **Analytics and billing days are WIB (UTC+7, fixed offset, no DST)** for all sponsors.
   - Why: sponsors are platform-wide and one bucket keeps rollups consistent. The skew for WITA/WIT is 1–2 h around midnight.
9. **Signed event token per served ad:**
   - A jose HS256 JWT with its own secret `AD_EVENT_SECRET` (≥32 bytes, checked at startup) and `aud:"sh-ad-event"`.
   - It is bound to the user and valid for 6 h.
   - Why: impressions and clicks cannot be forged for ads that were never served, or replayed by another student. It can never be confused with an access token.
10. **Impressions:**
    - The app reports them when a slide is actually visible. The report carries the token and is batched.
    - Each impression is counted at most once per (student, ad) per 30 min, using an in-memory TTL store behind a `DedupeStore` interface.
    - Impressions are only ever added to `AdDailyStat`, never billed.
    - Why: the deck's "Tayang" means seen, not fetched, and no raw table is needed.
11. **In-memory limiters need a single PM2 fork-mode process** (as in lims). A Redis implementation (127.0.0.1:6379) sits behind the same interfaces for when the app is clustered.
    - Why: KISS. The worst case after a restart is a few extra impressions counted; billing is protected by the database unique key.
12. **Every balance change goes through `withSponsorLock`:**
    - `SELECT … FROM Sponsor … FOR UPDATE` → append a ledger entry with seq+1 → a CAS update where `balance = <locked value>`.
    - The CHECK `balance >= 0` is the backstop.
    - Why: no lost updates, and seq collisions surface as errors.
13. **One ledger row per CHARGED click.** Why: auditable per click. Growth is about one row per paid click, which is fine for years.
14. **Rollups:**
    - Clicks update `AdDailyStat` in the same transaction as the click row.
    - Impressions use one multi-row `INSERT … ON DUPLICATE KEY UPDATE` per batch, with rows sorted by adId to prevent deadlocks.
    - "Klik Unik" for a period, and the device and province breakdowns, are raw `AdClick` queries on covering indexes.
    - Why: distinct-over-range cannot be summed from daily rollups.
15. **Device type is self-reported by the app** (expo-device `Device.deviceType`, sent in the click body). **Province is the school's province** (snapshot on AdClick), never GPS.
    - Why: it is the only available signal, and it is not security-relevant. Province needs no location data from minors.
16. **Serving:**
    - Candidates are fetched once per school and cached for 30 s.
    - Selection is deterministic per (student, WIB hour): the ads are sorted by `sha256(seed+adId)`. At most 5 ads are shown, at most 2 per sponsor.
    - Why: every eligible ad gets an equal expected share of the first slot, no single sponsor can fill the slider, the slider order stays stable for the hour, and it is unit-testable.
17. **Only these students are served ads and can click:** STUDENT role, `Student.status=ACTIVE`, `School.isActive`, and a user that is active and has already changed the admin-set initial password. All other click attempts get 403 and no row is written.
    - Why: sponsors should not pay for graduated or inactive accounts.
18. **Link rules:**
    - EXTERNAL_URL: `https:` only.
    - DEEP_LINK: `studenthub://` only, with the host on an allow-list.
    - Every other scheme is rejected: `http:`, `javascript:`, `data:`, `vbscript:`, `file:`, `blob:`, `intent:`, and so on.
    - Why: https universal/app links already open advertiser apps. Android `intent:` URIs can launch arbitrary components.
19. **Banner images:**
    - Accepted: JPEG, PNG or WebP, at most 5 MB, a 2:1 aspect ratio ±2%, width ≥ 800 px, at most 25 MP.
    - Rejected: animated images and SVG.
    - Each image is re-encoded to WebP at 1200×600, quality 82, with EXIF stripped.
    - Why: students are on mobile data, and SVG is an XSS vector.
20. **Top-up:**
    - Submitted as one multipart request (form fields plus the proof image).
    - Approval credits exactly the requested amount. A wrong amount means reject and resubmit.
    - Approval is allowed even if the sponsor is SUSPENDED, because the money was received.
    - Why: KISS, and no orphan proof files.
21. **Ledger entry sign rules:** TOPUP > 0, CLICK_CHARGE < 0, REFUND < 0 (money paid back out to the sponsor), ADJUSTMENT ≠ 0 (a signed correction, e.g. crediting invalid clicks).
    - REFUND and ADJUSTMENT are super admin only and require a note.
    - Why: the sign of every type is unambiguous. The client still needs to confirm REFUND (Q5).
22. **Low-balance alert on crossing only:**
    - LOW: `before >= 100_000 > after`.
    - EXHAUSTED: `before >= cpc > after`.
    - Both reuse the `LOW_BALANCE` type with `data.level`.
    - Why: one notification per crossing with no dedupe state, and a top-up re-arms it naturally.
23. **The click API returns the current `targetUrl`, or `null` if the ad is no longer live.** The app opens the URL from the click response and falls back to the serve payload only on a network error.
    - Why: a takedown takes effect on the very next click.
24. **Analytics periods:**
    - Presets: `7d` = today−6 … today; `30d` = today−29 … today. Custom ranges are at most 92 days, and `to` cannot be after today.
    - The previous period is the equal-length window just before `from`.
    - `changePct = (cur−prev)/prev×100` to 1 decimal: `null` when prev=0<cur, `0` when both are 0. CTR uses a relative change too, as in the deck.
25. **One route set per purpose, scoped by the session:** a sponsor gets its own sponsorId; a super admin must pass `sponsorId` for sponsor analytics. Why: DRY. `resolveSponsorScope` is pure and tested.

## 2. Endpoints

Envelope `{success,data,error:{code,message,fields?},meta:{total,page,limit}}`. Lists use `page≥1, limit≤100 (default 20)`. Money is integer rupiah. Analytics dates are `YYYY-MM-DD` (WIB). Instants are ISO-8601 UTC.

| METHOD | PATH | ROLE(S) | purpose | key request fields | key response fields |
|---|---|---|---|---|---|
| GET | /api/v1/student/ads | STUDENT | Slider ads | – | `ads[{token,adId,title,imageUrl,targetUrl,linkType,sponsorName}]`, `refreshAfterSeconds` (1800) |
| POST | /api/v1/student/ads/impressions | STUDENT | Batch of visible impressions | `events[{token}]` (1–20) | `accepted,duplicate,rejected` |
| POST | /api/v1/student/ads/clicks | STUDENT | Record click and bill | `token`, `deviceType?` (PHONE\|TABLET\|DESKTOP\|TV\|UNKNOWN) | `targetUrl\|null, linkType` (never billing info) |
| GET | /api/v1/sponsor/profile | SPONSOR | Own profile | – | `companyName,contact*,address,status,statusReason` |
| PATCH | /api/v1/sponsor/profile | SPONSOR (not SUSPENDED) | Edit contact details | `contactName?,contactPhone?,address?` | profile |
| GET | /api/v1/sponsor/balance | SPONSOR | Saldo card ("Sisa … dari total …") | – | `balance,totalFunded,totalSpent,totalRefunded,lowBalanceThreshold,estimatedClicksRemaining,topUpAccount{bankName,accountNumber,accountHolder},minTopUpAmount` |
| POST | /api/v1/sponsor/banners | SPONSOR (not SUSPENDED) | Upload banner | multipart `file` | `fileId,url,width,height,sizeBytes` |
| GET | /api/v1/sponsor/ads | SPONSOR | List own ads | `status?,displayStatus?,q?,page,limit` | `items[{id,title,imageUrl,targetUrl,linkType,startAt,endAt,status,displayStatus,isActive,cpcAmount,updatedAt}]` |
| POST | /api/v1/sponsor/ads | SPONSOR (not SUSPENDED) | Create DRAFT | `title,imageFileId,linkType,targetUrl,startAt,endAt,targetScope,targets{provinceCodes?\|cityCodes?\|schoolIds?}` | ad |
| GET | /api/v1/sponsor/ads/{id} | SPONSOR | Detail | – | ad + `targets[{code/id,name}]`, `reviewNote`, `submittedAt` |
| PATCH | /api/v1/sponsor/ads/{id} | SPONSOR (not SUSPENDED) | Edit | any create field (partial), `expectedUpdatedAt` | `ad, reReviewTriggered` |
| DELETE | /api/v1/sponsor/ads/{id} | SPONSOR | Delete a never-served DRAFT | – | `{deleted:true}` |
| POST | /api/v1/sponsor/ads/{id}/submit | SPONSOR (APPROVED) | DRAFT\|REJECTED → PENDING_REVIEW; snapshot CPC | – | `status,cpcAmount,submittedAt` |
| POST | /api/v1/sponsor/ads/{id}/withdraw | SPONSOR | PENDING_REVIEW → DRAFT | – | ad |
| POST | /api/v1/sponsor/ads/{id}/pause | SPONSOR | APPROVED → PAUSED | – | ad |
| POST | /api/v1/sponsor/ads/{id}/resume | SPONSOR (APPROVED) | PAUSED → APPROVED | – | ad |
| POST | /api/v1/sponsor/ads/{id}/archive | SPONSOR | Any except PENDING_REVIEW → ARCHIVED | – | ad |
| GET | /api/v1/sponsor/targeting/schools | SPONSOR, SUPER_ADMIN | School picker | `q,provinceCode?,cityCode?,page,limit` | `items[{id,name,cityName,provinceName}]` (active schools only) |
| GET | /api/v1/sponsor/topups | SPONSOR | Top-up history | `status?,page,limit` | `items[{id,amount,transferDate,status,reviewNote,createdAt}]` |
| POST | /api/v1/sponsor/topups | SPONSOR (APPROVED) | Request top-up | multipart `amount,transferDate,senderName,senderBank,note?,proof` | `topUp{id,status:PENDING}` |
| POST | /api/v1/sponsor/topups/{id}/cancel | SPONSOR | Own PENDING → CANCELLED | – | topUp |
| GET | /api/v1/sponsor/ledger | SPONSOR | Ledger | `type?,from?,to?,page,limit` | `items[{seq,type,amount,balanceAfter,note,adId?,topUpRequestId?,createdAt}]` |
| GET | /api/v1/sponsor/analytics/summary | SPONSOR, SUPER_ADMIN | KPI cards | `preset=7d\|30d` or `from,to`; `adId?`; `sponsorId` (super admin only, required) | `period{from,to,prevFrom,prevTo,days}`, `kpis{impressions,clicks,uniqueClicks,ctr,spend,chargedClicks}` each `{value,previous,changePct}` |
| GET | /api/v1/sponsor/analytics/timeseries | same | Daily chart and bars | same | `days[{date,impressions,clicks,uniqueClicks,spend}]` (zero-filled) |
| GET | /api/v1/sponsor/analytics/breakdown | same | Device or province split | same + `dimension=device\|province` | `items[{key,label,clicks,sharePct}]` |
| GET | /api/v1/sponsor/analytics/ads | same | Per-ad table; top 3 = `sort=clicks&limit=3` | same + `sort=clicks\|impressions\|ctr\|spend`, `displayStatus?`, `page,limit` | `items[{adId,title,imageUrl,targetUrl,startAt,endAt,displayStatus,isActive,impressions,clicks,ctr,spend}]` |
| POST | /api/v1/admin/sponsors | SUPER_ADMIN | Create sponsor and its first login | `companyName,contactName,contactEmail,contactPhone,address?,login{name,email,initialPassword}` | `sponsor{id,status:PENDING},userId` |
| GET | /api/v1/admin/sponsors | SUPER_ADMIN | List | `status?,q?,page,limit` | `items[{id,companyName,status,balance,liveAds,pendingTopUps}]` |
| GET | /api/v1/admin/sponsors/{id} | SUPER_ADMIN | Detail | – | sponsor + `members[]`, balance summary |
| PATCH | /api/v1/admin/sponsors/{id} | SUPER_ADMIN | Edit company data | `companyName?,contact*?,address?` | sponsor |
| POST | /api/v1/admin/sponsors/{id}/approve | SUPER_ADMIN | PENDING → APPROVED | – | sponsor |
| POST | /api/v1/admin/sponsors/{id}/suspend | SUPER_ADMIN | PENDING\|APPROVED → SUSPENDED | `reason` (5–255) | sponsor |
| POST | /api/v1/admin/sponsors/{id}/reinstate | SUPER_ADMIN | SUSPENDED → APPROVED | – | sponsor |
| POST | /api/v1/admin/sponsors/{id}/members | SUPER_ADMIN | Add another sponsor login | `name,email,initialPassword` | `userId` |
| GET | /api/v1/admin/sponsors/{id}/ledger | SUPER_ADMIN | Ledger | as sponsor ledger | as sponsor ledger |
| POST | /api/v1/admin/sponsors/{id}/ledger-adjustments | SUPER_ADMIN | Correction or refund | `type:ADJUSTMENT\|REFUND, amount` (signed), `note` (5–255) | `entry{seq,amount,balanceAfter}` |
| GET | /api/v1/admin/ads | SUPER_ADMIN | Review queue / all ads | `status` (default PENDING_REVIEW, oldest `submittedAt` first), `sponsorId?,q?,page,limit` | `items[{id,title,imageUrl,targetUrl,urlHost,isPunycodeHost,linkType,startAt,endAt,targets,cpcAmount,submittedAt,sponsor{id,companyName,status,balance}}]` |
| GET | /api/v1/admin/ads/{id} | SUPER_ADMIN | Review detail | – | as above + previous `reviewNote` |
| POST | /api/v1/admin/ads/{id}/approve | SUPER_ADMIN | PENDING_REVIEW → APPROVED | `submittedAt` | ad |
| POST | /api/v1/admin/ads/{id}/reject | SUPER_ADMIN | PENDING_REVIEW → REJECTED | `submittedAt,reviewNote` | ad |
| POST | /api/v1/admin/ads/{id}/takedown | SUPER_ADMIN | APPROVED\|PAUSED\|PENDING_REVIEW → REJECTED | `reviewNote` | ad |
| GET | /api/v1/admin/topups | SUPER_ADMIN | Top-up queue | `status` (default PENDING), `sponsorId?,page,limit` | `items[{id,sponsor,amount,transferDate,senderName,senderBank,proofFileId,duplicateProofOf[],createdAt}]` |
| GET | /api/v1/admin/topups/{id} | SUPER_ADMIN | Detail | – | topUp |
| POST | /api/v1/admin/topups/{id}/approve | SUPER_ADMIN | Credit the balance | – | `topUp, ledgerEntry{seq,balanceAfter}` |
| POST | /api/v1/admin/topups/{id}/reject | SUPER_ADMIN | Reject | `reviewNote` | topUp |
| GET | /api/v1/admin/ads-overview | SUPER_ADMIN | Platform KPIs | `preset\|from,to` | `impressions,clicks,revenue,liveAds,approvedSponsors,pendingAdReviews,pendingTopUps,topSponsors[5]` |
| GET, PATCH | /api/v1/admin/settings/ads | SUPER_ADMIN | PlatformSetting | `defaultCpcAmount,minTopUpAmount,topUpBankName,topUpAccountNumber,topUpAccountHolder` | settings |
| POST | /api/v1/internal/jobs/ads-banner-gc | cron secret | Delete orphan banners older than 24 h | – | `{deleted}` |
| POST | /api/v1/internal/jobs/ads-reconcile | cron secret | Check money and rollups (daily 01:00 WIB) | `date?` | `{balanceMismatches[],rollupRepairs[]}` |

**Dependencies on the platform/files domain:**
- Public banner URL: `storage.publicUrl(file)`.
- The private file route `GET /api/v1/files/{id}` must allow TOPUP_PROOF files only to SUPER_ADMIN, or to a SPONSOR whose `file.sponsorId = session.sponsorId`.

**Policy-map entries:** `ads.serve`, `ads.event` (STUDENT); `sponsor.self`, `ads.own`, `topup.submit`, `ledger.own`, `analytics.own` (SPONSOR); `sponsor.admin`, `ads.review`, `topup.review`, `ledger.adjust`, `settings.ads`, `analytics.any` (SUPER_ADMIN).

## 3. Business rules and algorithms

**Constants** (in `src/lib/ads/constants.ts` and `src/lib/sponsors/constants.ts`):
```
AD_TOKEN_TTL_SECONDS=21_600  SERVE_REFRESH_HINT_SECONDS=1_800  SERVE_CACHE_TTL_MS=30_000
MAX_ADS_PER_SLIDER=5  MAX_ADS_PER_SPONSOR_IN_SLIDER=2  MAX_SERVE_CANDIDATES=200  ROTATION_BUCKET_MINUTES=60
IMPRESSION_DEDUPE_WINDOW_MS=1_800_000  IMPRESSION_BATCH_MAX=20  IMPRESSION_REQ_LIMIT=30/60s  DEDUPE_STORE_MAX_ENTRIES=200_000
CLICK_RATE_LIMIT=10/60s per user  CLICK_REPEAT_IGNORE_MS=10_000  CLICK_TX={timeout:5_000,maxWait:3_000}  ADMIN_TX={timeout:20_000,maxWait:10_000}
TX_MAX_ATTEMPTS=3 (P2034)  WIB_OFFSET_MIN=420
BANNER_MAX_INPUT_BYTES=5_242_880  BANNER_FORMATS=[jpeg,png,webp]  BANNER_ASPECT=2  BANNER_ASPECT_TOLERANCE=0.02
BANNER_MIN_WIDTH=800  BANNER_MAX_INPUT_PIXELS=25_000_000  BANNER_OUT=1200x600 webp q82  BANNER_ORPHAN_TTL_HOURS=24
AD_TITLE=3..100  AD_URL_MAX=2000  APP_DEEP_LINK_SCHEME="studenthub"  DEEP_LINK_ALLOWED_HOSTS=["promo"] (pending Q3)
AD_MIN_DURATION_MS=3_600_000  AD_MAX_DURATION_DAYS=366  AD_MAX_START_LEAD_DAYS=365
MAX_TARGETS_PER_AD=100  MAX_NON_ARCHIVED_ADS_PER_SPONSOR=50
CPC_MIN_RP=100  CPC_MAX_RP=100_000  TOPUP_MAX_RP=100_000_000  TOPUP_MIN_FLOOR_RP=10_000
TOPUP_MAX_TRANSFER_AGE_DAYS=30  MAX_PENDING_TOPUPS_PER_SPONSOR=3  PROOF_MAX_INPUT_BYTES=5_242_880
ADJUSTMENT_MAX_ABS_RP=100_000_000  LOW_BALANCE_THRESHOLD_RP=100_000  REVIEW_NOTE=5..255
ANALYTICS_MAX_RANGE_DAYS=92  ANALYTICS_PRESETS={7d:7,30d:30}  PER_AD_TABLE_MAX_ADS=500
```

1. **Creating a sponsor account** (one transaction):
   - Create the Sponsor (PENDING, balance 0) and a User with role SPONSOR, email trimmed and lowercased, bcrypt hash, `mustChangePassword=true`.
   - A P2002 on email → 409 `EMAIL_TAKEN`. Write an audit entry `sponsor.create`.
   - `addSponsorMember` runs the same user creation for an existing sponsor.
2. **Sponsor transitions** (pure `nextSponsorStatus`): approve (PENDING→APPROVED); suspend (PENDING|APPROVED→SUSPENDED, reason required); reinstate (SUSPENDED→APPROVED). Anything else → 409 `SPONSOR_INVALID_TRANSITION`.
   - Each transition is a CAS `updateMany where status=<expected>`; a count of 0 → 409.
   - Notifications: SPONSOR_APPROVED (approve and reinstate) or SPONSOR_SUSPENDED to all members. Audit entry.
3. **Sponsor gate** (pure `assertSponsorCan(action, status)`):
   - `draft` (create, edit or delete a DRAFT ad; upload a banner; edit profile): PENDING or APPROVED.
   - `submit`, `resume`, `topup`: APPROVED only.
   - `pause`, `archive`, `withdraw`, `cancelTopUp`: any status.
   - SUSPENDED → 403 `SPONSOR_SUSPENDED` ("Akun sponsor ditangguhkan."); PENDING → 403 `SPONSOR_NOT_APPROVED`.
4. **Banner upload:**
   - Reject anything over 5 MB before decoding.
   - Read `sharp(buf,{limitInputPixels:25e6}).metadata()`. The format must be jpeg, png or webp (sniffed from the bytes; the client mime is ignored), `pages ≤ 1`, and `checkBannerDimensions(w,h)` must pass: `w≥800`, `h≥400`, `|w/h−2|/2 ≤ 0.02`, `w·h ≤ 25e6`.
   - Resize with `cover` to 1200×600 and save as WebP q82 (no metadata).
   - Store as StoredFile{kind:AD_BANNER, sponsorId, width, height, sha256}.
   - Errors → 422 `BANNER_INVALID` with a reason code (FORMAT|ANIMATED|TOO_LARGE|TOO_SMALL|ASPECT|PIXELS).
5. **Attaching a banner:**
   - `imageFileId` must be kind AD_BANNER with `sponsorId = caller`; otherwise 404 `FILE_NOT_FOUND`.
   - Several of the sponsor's own ads may reuse one file.
6. **Target URL** (pure `validateAdTargetUrl(raw, linkType)`):
   - Trim. Reject if the length is over 2000, or it contains `[\u0000-\u001F\u007F\s]` after trimming. `new URL()` must succeed.
   - EXTERNAL_URL requires:
     - `protocol==="https:"`
     - empty username and password
     - a hostname that is not an IPv4/IPv6 literal, not `localhost`, and contains a dot
   - DEEP_LINK requires `protocol==="studenthub:"` and a host in `DEEP_LINK_ALLOWED_HOSTS`.
   - Store `url.href` (canonical; IDN hosts become punycode). Return `{href, host, isPunycodeHost}` so the reviewer can see homograph attempts.
   - Any other scheme → 422 `URL_INVALID`.
7. **Schedule** (pure `validateSchedule`):
   - `endAt − startAt ≥ 1 h` and `≤ 366 d`; `startAt ≤ now + 365 d`.
   - On submit or resume, `endAt > now` is also required. `startAt` may be in the past (the ad starts at approval).
   - Input is ISO-8601 with an offset (`z.iso.datetime({offset:true})`) and is stored as a UTC instant.
8. **Targets** (pure `normalizeTargets(scope, input)`):
   - ALL → no rows; a non-empty targets list → 422.
   - PROVINCE, CITY or SCHOOL → exactly the matching array: 1–100 entries, deduplicated. Formats: province `^\d{2}$`, city `^\d{2}\.\d{2}$`, school cuid.
   - The service checks that the codes exist and the schools are active (422 `TARGETS_INVALID`).
   - On edit, the targets are replaced (`deleteMany` + `createMany`) in the same transaction as the ad update.
9. **Ad create:**
   - Only while the sponsor has fewer than 50 non-archived ads (else 422 `AD_LIMIT_REACHED`).
   - Status DRAFT; `cpcAmount` = the current default (an estimate only).
10. **Ad transitions** (pure `nextAdStatus(current, action, ctx)`):
    - edit: DRAFT|REJECTED → same status. APPROVED|PAUSED → PENDING_REVIEW if `requiresReReview`, else unchanged. PENDING_REVIEW → 409 `AD_EDIT_WHILE_PENDING` ("Iklan sedang ditinjau; tarik pengajuan dulu untuk mengubahnya."). ARCHIVED → 409.
    - submit: DRAFT|REJECTED → PENDING_REVIEW (sponsor APPROVED, schedule valid for submit). Sets `submittedAt=now` and `cpcAmount=settings.defaultCpcAmount`. Notifies all active SUPER_ADMIN users with AD_SUBMITTED.
    - withdraw: PENDING_REVIEW → DRAFT.
    - approve (super admin): PENDING_REVIEW → APPROVED. Requires sponsor APPROVED (else 409), `endAt > now` (else 409 "jadwal sudah berakhir"), and a CAS on `submittedAt`. Notifies AD_APPROVED.
    - reject: PENDING_REVIEW → REJECTED. Note required; CAS on `submittedAt`. Notifies AD_REJECTED.
    - takedown: APPROVED|PAUSED|PENDING_REVIEW → REJECTED. Note required. Notifies AD_REJECTED with `data.takedown=true`.
    - pause: APPROVED → PAUSED. resume: PAUSED → APPROVED (sponsor APPROVED and `endAt > now`; otherwise extend the schedule first).
    - archive: DRAFT|REJECTED|APPROVED|PAUSED → ARCHIVED (terminal).
    - delete: DRAFT with no AdClick and no AdDailyStat rows → hard delete (targets cascade). Otherwise 409 "arsipkan saja".
    - Every mutation is a CAS `updateMany where id, sponsorId, status=<from>` (and `updatedAt=expectedUpdatedAt` when given). Audit on submit, approve, reject and takedown.
11. **Re-review test** (pure `requiresReReview(before, patch)`): true if any of these differ: imageFileId, targetUrl (canonical), linkType, targetScope, or the target set (order-insensitive). Title, startAt and endAt never trigger it.
12. **Display status** (pure `deriveAdDisplayStatus(ad, sponsor, now)`), checked in this order: ARCHIVED, DRAFT, PENDING_REVIEW, REJECTED → the same name; `endAt ≤ now` → ENDED; PAUSED; `sponsor.status≠APPROVED` → SPONSOR_SUSPENDED; `startAt > now` → SCHEDULED; `balance < cpcAmount` → NO_BALANCE; else LIVE. `isActive = LIVE`.
    - Boundaries: `startAt == now` is LIVE; `endAt == now` is ENDED; `balance == cpc` is LIVE.
13. **Serve** (`serveAdsForStudent`):
    - Eligibility: the student meets decision 17; otherwise return `[]` (200).
    - Candidates are cached per `schoolId` for 30 s and fetched with:
      ```ts
      where:{status:"APPROVED",startAt:{lte:now},endAt:{gt:now},sponsor:{status:"APPROVED"},
        OR:[{targetScope:"ALL"},{targets:{some:{OR:[{provinceCode:s.provinceCode},{cityCode:s.cityCode},{schoolId:s.id}]}}}]},
      orderBy:{id:"asc"}, take:200  // + sponsor{companyName,balance}, targets, imageFile
      ```
    - A pure filter then checks `isAdServable` (`balance ≥ cpcAmount`, and `matchesTarget` again as a second check).
    - Selection: `selectAdsForSlider(candidates, rotationSeed(userId, now))`. Order by `sha256(seed+adId)` ascending; take in order, skipping any sponsor that already has 2; stop at 5. `seed = userId + ":" + wibDate + ":" + floor(wibMinuteOfDay/60)`.
    - Sign one token per ad: `{v:1,a:adId,sp:sponsorId,u:userId,sc:schoolId,iat,exp:iat+21600}` with `aud:"sh-ad-event"`, `iss:"studenthub"`.
14. **Impressions:**
    - Request limit per user → 429.
    - For each event, verify the token (signature, audience, expiry, `u==session.userId`). A failure counts as `rejected` and is not an error for the whole batch.
    - Dedupe key `u:a`, 30 min: already seen → `duplicate`.
    - Group the accepted events by `(a, wibDate(now))` using the server time. Run one `INSERT INTO AdDailyStat(adId,date,sponsorId,impressions) VALUES … ON DUPLICATE KEY UPDATE impressions=impressions+VALUES(impressions)`, rows sorted by adId, retried on deadlock.
    - An ad's liveness is not checked; the impression really was shown.
15. **Click** (`recordClick`):
    ```
    verify token (403 AD_TOKEN_INVALID; u must equal session.userId) → click limiter (429, no row)
    → student eligible (403, no row) → date = wibDate(now)
    → repeat guard: last AdClick(adId,userId,date) with createdAt > now−10s ⇒ return current targetUrl, no row
    → withSponsorLock(sp, CLICK_TX):
        SELECT id,status,balance FROM Sponsor WHERE id=? FOR UPDATE      -- lock first, then plain reads
        ad (status,startAt,endAt,cpcAmount,targetUrl,linkType,targets); live = isAdLiveFor(ad, sponsor, school, now)
        chargedToday = exists AdClick(adId,userId,billableDate=date); firstToday = !exists AdClick(adId,userId,date)
        billing = classifyClick({live, chargedToday, balance, cpc})       -- AD_NOT_LIVE > DUPLICATE > INSUFFICIENT_BALANCE > CHARGED
        insert AdClick{…, provinceCode/cityCode from school, deviceType=mapDeviceType(body.deviceType),
                       billableDate = CHARGED ? date : null, chargeAmount = CHARGED ? cpc : 0}
        if CHARGED: appendLedgerEntry(CLICK_CHARGE, −cpc, adClickId)       -- CAS balance, seq = MAX(seq)+1
        upsert AdDailyStat(adId,date): clicks+1, uniqueClicks+firstToday, chargedClicks+CHARGED, spend+charge   -- last statement
    → after commit: alert = detectBalanceAlert(before, after, 100_000, cpc) ⇒ notify members LOW_BALANCE{level}
    → respond {targetUrl: live ? ad.targetUrl : null, linkType}
    ```
    - A P2002 on `billableDate` (a race the lock should prevent) → reclassify as DUPLICATE and insert again.
    - Clicks by other roles → 403.
16. **Ledger append** (`appendLedgerEntry(tx, locked, entry)`):
    - `validateLedgerEntry` enforces the sign rule per type and `|amount| ≤ 100_000_000` (not applied to CLICK_CHARGE, which is bounded by CPC).
    - `nextBalance`: a negative result → 422 `INSUFFICIENT_BALANCE`.
    - `seq = (SELECT MAX(seq) … WHERE sponsorId=?)+1`. Insert the entry.
    - `sponsor.updateMany({where:{id, balance:locked.balance}, data:{balance:newBalance}})`; a count other than 1 → throw a conflict and retry.
17. **Top-up submit:**
    - Sponsor APPROVED; fewer than 3 PENDING requests (else 409 `TOPUP_LIMIT`).
    - `validateTopUp`: an integer from `max(settings.minTopUpAmount, 10_000)` up to 100_000_000. `transferDate` must be no later than today (WIB) and no more than 30 days back.
    - The proof image is re-encoded to WebP (max 5 MB input; jpeg, png or webp only) as StoredFile{TOPUP_PROOF, sponsorId}.
    - Create the TopUpRequest PENDING and notify super admins (TOPUP_SUBMITTED).
18. **Top-up approve:**
    - `withSponsorLock(sponsorId, ADMIN_TX)`, then a CAS `topUpRequest.updateMany where id, status=PENDING` → APPROVED (a count of 0 → 409 `TOPUP_ALREADY_REVIEWED`).
    - `appendLedgerEntry(TOPUP, +amount, topUpRequestId)`. The unique `topUpRequestId` is the backstop.
    - Audit `topup.approve`; notify TOPUP_APPROVED.
    - Reject: CAS PENDING → REJECTED, note required, notify. Cancel: the sponsor's own request, CAS PENDING → CANCELLED.
    - Lock order is always Sponsor first, then the request row, the same order as clicks.
19. **Duplicate proof:** in the queue, `duplicateProofOf` lists other TOPUP_PROOF files with the same `sha256` (any sponsor). It is a flag only, never an automatic reject.
20. **Balance summary** (pure `summarizeBalance`):
    - `totalFunded` = Σ TOPUP + Σ positive ADJUSTMENT.
    - `totalSpent` = −Σ CLICK_CHARGE, read from `Σ AdDailyStat.spend`.
    - `totalRefunded` = −Σ REFUND.
    - `estimatedClicksRemaining` = `floor(balance / defaultCpc)`.
21. **Analytics period** (pure `resolvePeriod`): see decision 24. Errors → 400 `ANALYTICS_RANGE_INVALID` (from > to, to > today, more than 92 days, bad format).
    - A super admin without `sponsorId` → 400.
    - An `adId` must belong to the scoped sponsor → 404.
22. **Analytics sources:**
    - KPIs, time series and the per-ad table: `AdDailyStat` (`[sponsorId,date]`).
    - `uniqueClicks` for a period: `COUNT(DISTINCT userId) FROM AdClick WHERE sponsorId=? AND date BETWEEN ? AND ? [AND adId=?]`. The same query runs for the previous period.
    - Daily `uniqueClicks` in the time series comes from the rollup. The API docs note that the sum of daily uniques is not the period's unique count.
    - `ctr = clicks/impressions×100`, 2 decimals, `null` when there are 0 impressions. It can exceed 100%, because impressions are deduped per 30 min and clicks are not; this is documented.
    - Device and province breakdowns: `GROUP BY deviceType|provinceCode` on AdClick (all billing kinds), province names joined in. `sharePct` uses the largest-remainder method so it sums to 100.
    - Per-ad table: the sponsor's non-archived ads, plus archived ads that have stats in range (cap 500), merged in memory with the grouped rollup, then sorted. Ties: clicks desc, then impressions desc, then title. Zero rows are included.
23. **Reconcile job** (`JobRun("ads-reconcile","global",date)`):
    - (a) For every sponsor, `balance == last balanceAfter == Σ amount`. A mismatch is logged at error level and recorded in the JobRun result, never auto-fixed.
    - (b) For yesterday, rebuild the click fields of AdDailyStat (clicks, uniqueClicks, chargedClicks, spend) from AdClick and repair any drift. Impressions are left alone.
    - (c) Check that Σ CLICK_CHARGE for the day equals −Σ spend.
24. **Banner GC** (`JobRun("ads-banner-gc","global",date)`): delete AD_BANNER StoredFiles older than 24 h that no Ad references (row first, then the disk file). It is idempotent.
25. **Settings:** `defaultCpcAmount` must be between 100 and 100_000; changing it never reprices ads that were already submitted. `minTopUpAmount` must be ≥ 10_000. Changes are audited.

## 4. Service and pure modules

Session = `{userId, role, schoolId|null, sponsorId|null}`. Pure modules (`*` below) import nothing from Prisma and take `now` as a parameter.

```
src/lib/time/local-date.ts*        (shared with attendance) localDate(instant:Date, offsetMin:number):Date  // UTC-midnight
                                   wibDate(instant), addDays(d,n), diffDays(a,b), formatYmd(d), parseYmd(s)
src/lib/ads/constants.ts*          all named constants in section 3
src/lib/ads/errors.ts              class AdsError extends Error {status; code}; notFound(), conflict(), forbidden(), invalid()
src/lib/ads/schemas.ts             createAdSchema, updateAdSchema, adListQuery, clickSchema, impressionBatchSchema,
                                   reviewDecisionSchema, analyticsQuerySchema, settingsSchema  (zod v4; exported for OpenAPI)
src/lib/ads/ad-url.ts*             validateAdTargetUrl(raw:string, type:AdLinkType): Result<{href,host,isPunycodeHost}, UrlError>
src/lib/ads/banner-rules.ts*       checkBannerMeta(m:{format,width,height,pages,bytes}): Result<void, BannerErrorCode>
src/lib/ads/ad-schedule.ts*        validateSchedule(s:{startAt,endAt}, now, mode:"draft"|"submit"): Result
src/lib/ads/ad-targeting.ts*       normalizeTargets(scope, input): Result<TargetRow[]>; matchesTarget(ad, school): boolean;
                                   sameTargetSet(a,b): boolean
src/lib/ads/ad-transitions.ts*     nextAdStatus(cur, action, ctx:{sponsorStatus, endAt, now, reReview}): Result<AdStatus>;
                                   requiresReReview(before, patch): boolean
src/lib/ads/ad-display-status.ts*  deriveAdDisplayStatus(ad, sponsor, now): DisplayStatus; isAdLiveFor(ad, sponsor, school, now)
src/lib/ads/ad-rotation.ts*        rotationSeed(userId, now): string; selectAdsForSlider(c:Candidate[], seed, opts?): Candidate[]
src/lib/ads/ad-token.ts            signAdToken(p, key, now): Promise<string>; verifyAdToken(t, key, now): Promise<AdTokenPayload|null>
src/lib/ads/click-billing.ts*      classifyClick({live, chargedToday, balance, cpc}): ClickBilling; mapDeviceType(v?): DeviceType
src/lib/ads/rate-window.ts*        createSlidingLimiter({max, windowMs, clock}); createDedupeWindow({ttlMs, maxEntries, clock})
                                   (+ interfaces RateStore/DedupeStore; memory impl now, redis impl later)
src/lib/ads/analytics-period.ts*   resolvePeriod(q:{preset?,from?,to?}, today): Result<Period>
src/lib/ads/analytics-math.ts*     ctr(c,i), changePct(cur,prev), fillDailySeries(rows, from, to), shareBreakdown(rows),
                                   sortAdRows(rows, key)
src/lib/ads/scope.ts*              resolveSponsorScope(session, querySponsorId?): Result<{sponsorId}>
src/lib/ads/banner-service.ts      uploadBanner(session, file:{buf,name}): Promise<BannerDto>
src/lib/ads/ad-service.ts          createAd, updateAd, deleteDraftAd, submitAd, withdrawAd, pauseAd, resumeAd, archiveAd
                                   (session, id, input?) => Promise<AdDto>
src/lib/ads/ad-review-service.ts   approveAd(actor, id, {submittedAt}), rejectAd(actor, id, {submittedAt, note}), takedownAd(actor, id, {note})
src/lib/ads/ad-queries.ts          listSponsorAds(session, q), getSponsorAd(session, id), listReviewQueue(q), getAdForReview(id),
                                   searchTargetSchools(q)
src/lib/ads/serving-service.ts     serveAdsForStudent(session, now): Promise<ServedAd[]>   (+ per-school short cache)
src/lib/ads/event-service.ts       recordImpressions(session, events, now): Promise<{accepted,duplicate,rejected}>
                                   recordClick(session, input, now): Promise<{targetUrl:string|null, linkType}>
src/lib/ads/ad-stats-repo.ts       incrementImpressions(rows), incrementClickStats(tx, row), rebuildClickStats(tx, date)
src/lib/ads/analytics-queries.ts   getKpiSummary(scope, period, adId?), getDailySeries(...), getBreakdown(..., dim),
                                   getAdPerformance(..., sort, page), getPlatformOverview(period)
src/lib/ads/settings-service.ts    getAdSettings() (short cache), updateAdSettings(actor, input)
src/lib/ads/jobs/banner-gc.ts      runBannerGc(now)
src/lib/ads/jobs/reconcile.ts      runAdsReconcile(date, now)
src/lib/sponsors/constants.ts*, errors.ts, schemas.ts
src/lib/sponsors/sponsor-transitions.ts*  nextSponsorStatus(cur, action): Result; assertSponsorCan(action, status): Result
src/lib/sponsors/ledger-rules.ts*  validateLedgerEntry(type, amount): Result; nextBalance(bal, amount): Result<number>;
                                   detectBalanceAlert(before, after, threshold, cpc): "LOW"|"EXHAUSTED"|null;
                                   summarizeBalance(aggregates): BalanceSummary
src/lib/sponsors/topup-rules.ts*   validateTopUp({amount, transferDate}, {minTopUp}, today): Result; canSubmitTopUp(pendingCount)
src/lib/sponsors/sponsor-lock.ts   withSponsorLock<T>(sponsorId, opts, work:(tx, s:{id,status,balance})=>Promise<T>): Promise<T>
src/lib/sponsors/ledger-service.ts appendLedgerEntry(tx, locked, e): Promise<LedgerEntry>; adjustBalance(actor, sponsorId, input)
src/lib/sponsors/sponsor-service.ts createSponsorAccount(actor, input), updateSponsor, approveSponsor, suspendSponsor,
                                   reinstateSponsor, addSponsorMember, updateOwnProfile(session, input)
src/lib/sponsors/sponsor-queries.ts listSponsors(q), getSponsor(id), getBalanceSummary(sponsorId)
src/lib/sponsors/topup-service.ts  submitTopUp(session, input, proof), cancelTopUp(session, id), approveTopUp(actor, id), rejectTopUp(actor, id, note)
src/lib/sponsors/topup-queries.ts  listTopUps(scope, q) (with duplicateProofOf), getTopUp(scope, id)
src/lib/sponsors/ledger-queries.ts listLedger(sponsorId, q)
src/app/api/v1/{student/ads,sponsor/…,admin/…,internal/jobs/…}/route.ts   thin glue: gate → zod → service → error map
```

**Error codes:**
- 400 (zod validation); ANALYTICS_RANGE_INVALID 400.
- AD_NOT_FOUND / FILE_NOT_FOUND 404. Another tenant's resource is always 404.
- AD_INVALID_TRANSITION, AD_EDIT_WHILE_PENDING, AD_REVIEW_STALE, TOPUP_ALREADY_REVIEWED, TOPUP_LIMIT, EMAIL_TAKEN: 409.
- SPONSOR_SUSPENDED, SPONSOR_NOT_APPROVED, AD_TOKEN_INVALID, STUDENT_NOT_ELIGIBLE: 403.
- BANNER_INVALID, URL_INVALID, SCHEDULE_INVALID, TARGETS_INVALID, AD_LIMIT_REACHED, INSUFFICIENT_BALANCE: 422.
- RATE_LIMITED: 429.

## 5. Tests

**Unit tests** (node:test, colocated `*.test.ts`, injected clock):
- local-date: `2026-09-20T17:00:00Z`→`2026-09-21` WIB; `16:59:59.999Z`→`2026-09-20`; WITA/WIT offsets; addDays across month and leap day (2028-02-29).
- ad-url:
  - Accepts https and canonicalises it.
  - Rejects `http:`, and rejects `javascript:`/`data:`/`vbscript:`/`file:`/`blob:`/`intent:`, including uppercase, leading whitespace and `java%0Ascript:`.
  - Rejects userinfo (`https://bank.co.id@evil.com`), IPv4/IPv6 literals, localhost, dotless hosts, embedded whitespace/control characters, and length 2001.
  - Flags punycode (an IDN host).
  - DEEP_LINK: an allow-listed host passes; another host or another scheme fails.
  - EXTERNAL_URL rejects `studenthub://`.
- banner-rules: 1200×600, 800×400 and 2000×1000 pass; 1200×612 passes (inside tolerance); 1200×700, 799×400 and pixel count over the limit fail; gif, svg and heif fail; animated (pages=2) fails; 5 MB+1 byte fails.
- ad-schedule: end ≤ start; under 1 h; over 366 d; start more than 365 d ahead; submit with endAt ≤ now; a past startAt allowed on submit.
- ad-transitions:
  - A full (status × action) table.
  - Submit and resume need an APPROVED sponsor; resume after endAt → error.
  - Editing in PENDING_REVIEW → error.
  - Editing content on a PAUSED ad → PENDING_REVIEW; a schedule-only edit on APPROVED stays APPROVED.
  - `requiresReReview` per field; the target-set comparison ignores order.
- ad-display-status: every state; ENDED takes precedence over PAUSED; balance == cpc is LIVE, balance == cpc−1 is NO_BALANCE; boundaries `startAt==now` (LIVE) and `endAt==now` (ENDED).
- ad-targeting: ALL, PROVINCE, CITY and SCHOOL match and non-match; a scope/field mismatch, empty targets for a non-ALL scope, targets on ALL, deduplication, 101 targets, and a bad city code format.
- ad-rotation:
  - Deterministic for the same seed; the order differs across seeds.
  - At most 5 ads and at most 2 per sponsor. Fewer candidates than the cap → all returned; empty input → empty output.
  - Across 10k seeds, each of 10 ads takes slot 0 between 8% and 12% of the time.
  - The seed changes on the WIB hour and day boundary.
- ad-token: round-trip; rejects a tampered payload, the wrong secret, an access token (different secret and aud), an expired token (clock), and missing claims.
- click-billing: CHARGED; balance == cpc is CHARGED; DUPLICATE even when funded; INSUFFICIENT_BALANCE; AD_NOT_LIVE outranks the others; the `mapDeviceType` table including missing and TV.
- ledger-rules: sign per type; zero rejected; a negative result rejected; `detectBalanceAlert` gives LOW once on crossing, nothing if already below, EXHAUSTED ahead of LOW, nothing on an increase; `summarizeBalance` arithmetic.
- topup-rules: below the minimum; above the maximum; non-integer; future transfer date; transfer date older than 30 days; the fourth pending request is blocked.
- sponsor-transitions: a full table; `assertSponsorCan` matrix.
- rate-window: the 11th request within 60 s is blocked and released after the window; dedupe true, then false inside 30 min, then true after; eviction at the maximum; keys are isolated.
- analytics-period: 7d and 30d (current and previous windows); a single day; from > to; to > today; 93 days; bad format.
- analytics-math: CTR with 0 impressions → null; rounding; changePct (0/0 → 0, 0→n → null, negative); `fillDailySeries` zero-fills and drops out-of-range rows; `sharePct` sums to 100.
- scope: a sponsor's query `sponsorId` is ignored (forced to its own); a super admin without `sponsorId` → error.

**Integration tests** (`src/**/*.int.test.ts`, real MariaDB 10.11 in CI after `migrate deploy`, a separate CI step):
- Creating a sponsor makes a PENDING sponsor and a SPONSOR user with `mustChangePassword`; a duplicate email → 409.
- A PENDING sponsor can create a draft but submitting → 403; once approved, submit works and `cpcAmount` equals the setting at submit time.
- Approve with a stale `submittedAt` → 409; two concurrent approvals → exactly one succeeds.
- Sponsor A reading, patching or submitting sponsor B's ad → 404; attaching B's banner → 404.
- Changing an approved ad's image → PENDING_REVIEW, and the ad disappears from serve.
- Serve returns only eligible ads. Excluded: another province, a suspended sponsor, an unfunded sponsor, a paused ad, a future ad. Capped at 5; every token verifies.
- Serve returns `[]` for a GRADUATED student or an inactive school.
- Impressions: counted once per 30 min; another student's token → rejected; 21 events → 400; AdDailyStat increments.
- The first click is CHARGED: the ledger gets seq 1 with a correct `balanceAfter`, and the rollup fields change in the same transaction.
- The second click on the same day is DUPLICATE; the next WIB day (clock) is CHARGED again.
- 20 concurrent clicks from 20 students with balance for 5 clicks → exactly 5 CHARGED and 15 INSUFFICIENT_BALANCE; balance 0; seq 1–5 contiguous; never negative.
- A double click from the same student in parallel → exactly one CHARGED.
- A click after pause → AD_NOT_LIVE, `targetUrl` null, no charge. The 11th click in 60 s → 429 and no row. Another student's token → 403 and no row.
- A LOW_BALANCE notification is created exactly once per crossing.
- Top-up: approve credits the balance with a TOPUP entry and a notification; two concurrent approvals → one entry and one 409; approving a cancelled request → 409; reject without a note → 400; a duplicate proof is flagged in the queue.
- An adjustment larger than the balance → 422 and no row; a raw SQL update to a negative balance is rejected by the CHECK.
- Analytics: seeded clicks across two periods give correct KPIs and `changePct`; unique counts are distinct across days; the time series is zero-filled; device and province breakdowns; a super admin without `sponsorId` → 400.
- Reconcile repairs a tampered click rollup and reports a balance mismatch without fixing it; a second run on the same date is skipped (JobRun).
- Banner GC removes only unreferenced banners older than 24 h.
- `@db.Date` round-trip for a click at 23:30 WIB (16:30Z).
- A role-gate matrix: every endpoint returns 401 without a session and 403 for the other roles.

**E2E** (Playwright, API level):
- Super admin creates a sponsor and approves it → sponsor changes its password, uploads a banner, creates an ad and submits it → super admin approves the ad → sponsor requests a top-up → super admin approves it → student is served the ad, sends an impression and clicks → sponsor analytics shows 1 impression, 1 click, CTR 100.00, spend = cpc, and the balance is reduced by cpc.

## 6. SCHEMA CHANGE REQUESTS

1. **`StoredFile`:** add `width Int? @db.SmallInt` and `height Int? @db.SmallInt`. The review queue and the apps need banner dimensions without decoding the image. They are filled for all image kinds.
2. **`SponsorLedgerEntry`:** add `@@index([sponsorId, type, createdAt])`. The balance summary totals (TOPUP, REFUND, ADJUSTMENT) and a ledger filtered by type would otherwise scan every click-charge row.
3. **`AdClick`:** add `@@index([sponsorId, date, deviceType])` and `@@index([sponsorId, date, provinceCode])`. These are covering indexes for the device and province breakdowns. Clicks are low-volume, so the extra write cost is small.
4. **Doc comments only, no structural change:**
   - `Ad.cpcAmount`: "Estimate while DRAFT; snapshot of `PlatformSetting.defaultCpcAmount` at SUBMIT (every re-submit)."
   - `Ad.submittedAt`: "Also the CAS token for approve/reject."
   - `AdStatus`: "ENDED is derived (`endAt <= now`), not stored."
   - I am explicitly not adding an ENDED value.
5. **Additional CHECK constraints** in the init migration, on top of the schema designer's list:
   - `Ad.cpcAmount BETWEEN 100 AND 100000`; `TopUpRequest.amount > 0`; `AdClick.chargeAmount >= 0`; all AdDailyStat counters `>= 0`.
   - Ledger sign per type: `(type='TOPUP' AND amount>0) OR (type IN ('CLICK_CHARGE','REFUND') AND amount<0) OR (type='ADJUSTMENT' AND amount<>0)`.
   - `(topUpRequestId IS NOT NULL) = (type='TOPUP')` and `(adClickId IS NOT NULL) = (type='CLICK_CHARGE')`.
   - PlatformSetting: `defaultCpcAmount BETWEEN 100 AND 100000`, `minTopUpAmount >= 10000`.
6. **Seed migration:** the `PlatformSetting` row (id=1) with `defaultCpcAmount` and `minTopUpAmount`. The values come from client answer Q1; use 500 and 100000 until then.
7. **Only if the client says yes to Q4 (targeting by school level):** add `enum SchoolLevel {SD SMP SMA SMK}`, `School.level SchoolLevel?`, `AdTargetScope += LEVEL` (at the end of the enum) and `AdTarget.level SchoolLevel?`, extending the one-column CHECK.

## 7. Risks and open questions for the client

**Questions:**
1. **CPC price and minimum top-up.** What is the default price per click (Rp), and the minimum top-up? Do some sponsors need a special price?
2. **When a click is charged.** The default is at most once per student, per ad, per day; repeat clicks are free. Is that right, or should it be charged every click or once per hour?
3. **Deep links.** Which in-app screens may an ad open (`studenthub://…`)? Do you need other apps' schemes (e.g. `shopee://`), or are https links enough? Https links open the advertiser's app automatically when it is installed.
4. **Ad content for children.** Are there banned categories (rokok, judi, pinjol, kencan, …) beyond manual review? Do you need targeting by school level (SD/SMP/SMA/SMK)? Schools do not store their level yet.
5. **Balance.** Does "dari total Rp 2.000.000" mean all money ever topped up? Can unused balance be paid back to the sponsor (REFUND)?
6. **Top-up paperwork.** May the transfer proof be a PDF? The default is images only, because PDFs need a separate sanitising path. Do sponsors need a receipt or invoice (kuitansi, PPN) after a top-up is approved?
7. **Banner size.** Is 2:1 (1200×600) right for the mobile slider? This can wait until the UI phase.

**Risks** (no client input needed):
- **Sponsor row lock:** every charged click locks its sponsor's row. A burst, such as a school-wide broadcast at 07:00, serialises that sponsor's clicks at about 5 ms each. Mitigations: a short transaction timeout; move to asynchronous charging if a sponsor passes about 50 clicks/s.
- **In-memory limiters:** they need a single PM2 fork instance. Clustering needs the Redis store first.
- **Client-reported data:** impressions and device type are reported by the app. The token and dedupe limit inflation to one impression per student, per ad, per 30 min, and impressions are never billed. "Desktop" will be about 0% because students only use the mobile app.
- **Partial today:** the 7d and 30d presets include today, which is incomplete, so the % change is biased downward early in the day.
- **Caching:** a paused or suspended ad can still be displayed for up to 30 s because of the serve cache, but clicks on it are not charged (AD_NOT_LIVE). Only the first 200 eligible ads (in id order) are rotated.
- **Minors:** showing ads to children carries legal and reputational exposure (UU PDP, KPAI). Only manual review, takedown and the audit log protect against it. No personal data goes to sponsors: analytics are aggregated and province-level only.
