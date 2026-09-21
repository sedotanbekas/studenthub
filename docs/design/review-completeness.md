# REVIEW: completeness

SUMMARY: ## Coverage

The designs cover almost every feature in the spec. Three things are missing:
- **Holidays:** nothing in any design lets anyone enter a holiday (HIGH).
- **Map markers:** Izin, Sakit and Alpha rows have no coordinates, so those marker colours can never appear.
- **Deep links:** no usable deep-link target exists.

Four more are under-specified: the stat-card grouping, the device-type enum, which province/city dataset to use, and how the client will test without real data.

The larger scope risk is duplication. Student CRUD and import, sponsor accounts, platform settings, the push token and school settings are each designed two or three times, with rules that contradict each other. One of them reopens a security gap: attendance lets SCHOOL_ADMIN move the geofence, which auth D19 had closed. The route wrapper, CSRF, error codes, paths, jobs and uploads also differ between designs. Reconcile all of this into one ownership table and one merged schema before Phase 0.

## Spec features the designs already cover

- **Student app:**
  - Ad slider: `/student/ads`.
  - Attendance: today, check-in (selfie, geofence, TERLAMBAT), history and summary.
  - Leave requests: IZIN/SAKIT with an attachment.
  - Report cards: `/me/report-cards`, published only.
  - SPP: invoices, proof upload and receipts.
  - Pemberitahuan feed and unread badge: `/notifications`.
- **School admin:**
  - Student table: search by name/NIS/NISN, class filter, pagination.
  - Activation checks: required data validated before activation.
  - Grades: entry with row validation, and a semester selector labelled "Semester Ganjil 2025/2026".
  - SPP: invoices with Lunas/Belum Lunas, verification of transfer proofs, cash payments.
  - Announcements: 5 categories, sent to ALL, CLASSES or STUDENTS.
  - Attendance screens: Peta Lokasi, Data Absensi and Rekap Kelas tabs, anomalies, corrections.
  - Analytics: bar chart per class for a month, donut with change vs last month, trends per class and per student.
  - Stat cards: all four.
- **Sponsor:**
  - Banners: upload and airing period.
  - Links: destination URL per banner.
  - KPIs: Total Klik, Klik Unik, Total Tayang and CTR, each with % change vs the previous period.
  - Charts and breakdowns: 7d/30d/custom series of total vs unique clicks, device and province breakdowns.
  - Ads table: status Aktif/Nonaktif; top 3 via `sort=clicks&limit=3`.
  - Balance: "Sisa … dari total …" and top-up.
- **Super admin:** create schools, school admins, students and sponsors; approval workflows for sponsors, ads and top-ups.
- **Platform:** OpenAPI docs via Scalar, and CI/CD.

## Implementation order

Backend only. Each phase is deployed to staging, accepted through /docs, and covered by API-level Playwright tests.

### P0 Foundation (before F1)
**Build:**
- Reconcile ownership and conventions, and produce one merged schema.
- Scaffold Next 16 with a Prisma 7 multi-file schema containing only the foundation models.
- `db.ts` with an `initSql` that sets `time_zone='+00:00'`, and env validation.
- Request pipeline: `defineRoute` with the POLICY action, plus envelope, errors and pagination.
- Docs: zod-openapi with Scalar at /docs behind Basic auth.
- Shared modules: time, `withTx`, rate limiter, client IP, audit.
- Endpoints and jobs: `/api/health` returning the git sha; tick endpoint with the JobRun runner.
- Data: region migration and the PlatformSetting row.
- CI gate: typecheck, lint, `openapi:check`, unit tests, migrate on an empty DB, integration tests, and a zero-test guard.
- Deploy: the deploy workflow, plus VPS bootstrap (database, storage, nginx, PM2 fork on :3020, cron tick).
- Staging on :3021 with a skeleton `db:seed:demo`.

**Done when:** a push to master goes green, deploys, and health shows the sha on both instances.

### P1 (F1) Auth, tenancy, provisioning and student data
**Build:**
- **Auth:**
  - Login by NISN or email.
  - Bearer tokens with refresh rotation, reuse detection and the race window.
  - Logout and logout-all, `/auth/me`, and change-password with the mustChangePassword gate.
  - Sessions list and revoke, and push-token binding.
- **Provisioning:**
  - Super-admin CLI.
  - Schools CRUD, with the geofence editable by SUPER_ADMIN only, plus the school settings endpoint.
  - School-admin users.
- **Academic structure:** academic years, terms, active term and classes.
- **Holidays:** per school and national, with the calendar hook as a stub.
- **Students:** CRUD, activation, status changes, password reset and one import path.
- **Other:** audit-log list, the read side of the notification inbox, and the notify helper.

**Done when:**
- An E2E test passes: super admin creates a school and an admin, the admin sets up the year, term and classes, students are created, a student logs in with NISN, is forced to change the password, and `/auth/me` works.
- A two-school IDOR test suite passes.
- The tenant-lint test passes.

### P2 (F2a) Attendance and Maps data
**Build:**
- **Files:** image sanitising, the storage driver and the private file route.
- **Student side:** today, check-in, history and summary.
- **Leave requests:** images only; approve, reject and materialise into attendance rows; notifications.
- **Auto-ALPHA:** runs in the tick, aware of holidays and terms, across WIB/WITA/WIT.
- **Monitoring:**
  - Today's stats, daily list, recap and record detail.
  - The map, including students without a location.
  - Rejected attempts, and the v1 anomaly flags with the day-close sweep.
- **Admin corrections.**
- **Analytics:** class monthly chart, donut with change, trends per class and per student.
- **Selfie retention job.**

**Done when:**
- An E2E test passes: check-in, then history.
- Leave approval leads to IZIN.
- Auto-ALPHA is idempotent across timezones.
- Analytics give exact percentages on a seeded month.

### P3 (F2b) Report cards, SPP, announcements and push
**Build:**
- **Report cards:**
  - Subjects and the class-to-subject mapping.
  - Bulk grade entry, the readiness check, publish and unpublish.
  - The student's report card view.
- **Invoices:** single and bulk, with dry run and the number counter.
- **Payments:**
  - Proof submission as inline multipart, images only.
  - Approve, reject, cash payment and payment void.
  - Receipts, and the student's invoice and payment-info screens.
- **Announcements:** draft, publish now and retract; three audiences; recipient preview.
- **Notifications:** fan-out for every domain event.
- **Push dispatcher:** log and memory transports, switching to Expo once EAS is ready.
- **Dashboard:** `/school/dashboard/summary`.

**Done when:**
- An E2E test passes: grades are published and the student reads them.
- The bulk SPP → proof → approve flow ends LUNAS.
- A class announcement reaches only that class, and the unread badge updates.

### P4 (F3) Sponsor and ads
**Build:**
- **Sponsors:** accounts with approve, suspend and reinstate; platform settings.
- **Ads:**
  - Banner upload.
  - Ad CRUD, status transitions, review and takedown.
  - Targeting, including the deep-link allowlist.
- **Delivery and billing:**
  - Serving with signed event tokens, and impressions.
  - Clicks with the ledger and low-balance alert.
  - Top-ups and the balance card.
- **Analytics:** KPIs with % change, time series, device and province breakdowns, ads table and top 3.

**Done when:**
- An E2E test passes: sponsor creates an ad, it is approved, the sponsor tops up, a student is served the ad and clicks it, and analytics and the balance update.
- A money test passes: 20 concurrent clicks never overspend.
- The invariant `balance == ledger` holds.

### P5 (F4) Super admin operations, hardening and go-live
**Build:**
- **Operations:** job-run monitoring, and the cleanup and retention jobs.
- **Quality gates:** the full E2E suite and a c8 coverage gate of at least 80%.
- **Documentation:** OpenAPI examples and an Expo integration guide (refresh single-flight, check-in capture).
- **Go-live:**
  - A backup and restore drill.
  - The production domain with SSL.
  - EAS credentials, then `PUSH_TRANSPORT=expo`.
  - A sanity check of the 07:00 check-in burst.

## Questions for the client

Blocking ones first:
1. Which domain or subdomain will serve the API and the docs?
2. Is a staging instance on the VPS acceptable?
3. Where do national holidays come from, and who maintains them?
4. What should Izin, Sakit and Alpha markers on the map represent?
5. Which deep links do sponsors need, for example Shopee or Tokopedia?
6. Are PDFs needed, or are images enough?
7. How many days are selfies kept?
8. Who owns the Expo/EAS account?
9. Do schools need admin sub-roles (bendahara, operator), or is one school-admin role enough?
10. Does "Total Siswa nonaktif" mean INACTIVE only?
11. Be aware: until an Expo project exists, "real-time" means an in-app inbox, with web dashboards polling every 30 seconds.

- [HIGH] (attendance / school calendar: Holiday management is missing) The `Holiday` model (per school, or national when schoolId is NULL) drives `checkSchoolDay`, auto-ALPHA, leave `schoolDayCount` and `onCalendarChanged`. No design defines an endpoint to create, edit or delete holidays: auth/school, academic, attendance, platform and sponsor all leave it out. The attendance design says 'the school domain calls onCalendarChanged', but the school domain has no holiday routes. With the default mask 31, every national holiday or cuti bersama that falls on a weekday marks the whole school ALPHA. The student 'today' screen can also never show `holidayName`. This breaks the client rule 'auto ALPHA ... skip holidays/non-school days'.
  -> FIX: Add in Phase 1:
- `GET/POST /school/holidays` and `PATCH/DELETE /school/holidays/{id}`: SCHOOL_ADMIN for own school; SUPER_ADMIN with `schoolId`.
- `GET/POST/PATCH/DELETE /platform/holidays` for national rows, SUPER_ADMIN only.
- zod rules: name 3–150 characters, startDate ≤ endDate, span ≤ 60 days.
- Each mutation writes AuditLog and calls `attendance.onCalendarChanged` in the same transaction.
- Add a student read `GET /student/calendar?month=` that reuses the history's `nonSchoolDays`.
- Ship `scripts/import-national-holidays.ts` (JSON of the 2026–2027 SKB libur nasional and cuti bersama), run by the super admin. Do not use a migration, because this data is editable.
- Document the onboarding order: School → AcademicYear → Term (set active) → Classes → Holidays → Students. Optionally return a `setupChecklist` from `GET /schools/{id}`.

- [HIGH] (cross-domain: the same features are designed two or three times with conflicting rules) 1. **Student CRUD and import.**
   - auth: `/students`, activate=true by default (422 and nothing written), NISN claimed at ACTIVATION (D14), all-or-nothing XLSX import, `tokenVersion` dropped (D4).
   - academic: `/school/students`, create saves a DRAFT and returns `missingForActivation`, `claimNisn` at CREATE, JSON bulk ≤ 500 rows with one transaction per row, `tokenVersion + 1` on status change.
2. **Sponsor accounts.** auth `POST /admin/sponsors {account, approveImmediately}` vs sponsor-ads `POST /api/v1/admin/sponsors {login}`. Both also design approve, suspend and reinstate.
3. **Platform settings.** `/admin/platform-settings` vs `/admin/settings/ads`.
4. **Push token.** `PUT/DELETE /auth/push-token` vs `/me/push-token`.
5. **School settings.**
   - auth: `/schools/{id}/settings`; D19 makes geofence, location and timezone SUPER_ADMIN-only.
   - attendance: `PATCH /admin/school/attendance-settings` lets SCHOOL_ADMIN change latitude, longitude, geofenceRadiusM and timezone. This reopens the 'admin moves the geofence' hole that D19 closed.
   - academic: a third endpoint, `PUT /school/billing-settings`, for the bank fields.

Building both versions doubles the work and ships contradictory APIs.
  -> FIX: Freeze an ownership table before Phase 0.
- **auth-tenancy owns** students (CRUD, activation, status, import, reset), sponsor accounts and platform settings.
- **academic** consumes the student service and drops its own student endpoints and `claimNisn`.
- **attendance** drops its settings endpoint and only exports `validateAttendanceSettings`, used by:
  - `PATCH /schools/{id}` (SUPER_ADMIN: geofence, location, timezone);
  - `PATCH /schools/{id}/settings` (SCHOOL_ADMIN: schedule minutes, tolerance, school-days mask, bank fields).
- **platform** owns the single push-token route.

Settle the semantic forks explicitly:
- NISN is claimed at activation.
- There is no `tokenVersion`; each request looks up the AuthSession.
- Create with activate=true is atomic and returns 422 when data is missing.
- There is exactly one import path.

Merge the schema change requests from all five designs into one reconciled schema before the first migration.

- [MEDIUM] (cross-cutting conventions: pipeline, errors, paths, jobs and uploads differ between designs) Phase 0 builds the request pipeline first, so these must be settled before it starts; OpenAPI generation depends on them too.
- **Route wrapper:** auth's `apiRoute({action})` vs platform's `defineRoute(contract)`.
- **CSRF:** an HMAC token (auth D6) vs an Origin-only check (platform D17).
- **Error codes:** VALIDATION_ERROR vs VALIDATION_FAILED, SESSION_INVALID vs SESSION_REVOKED, CSRF_INVALID vs CSRF_FAILED, SCOPE_MISMATCH vs FORBIDDEN_SCOPE.
- **Super admin with no schoolId:** returns all schools in auth, but 400 in academic, attendance and platform.
- **Path prefixes:** flat `/students` (auth D26) vs `/school/*`. `/admin/attendance/*` means SCHOOL_ADMIN in attendance, but `/admin/*` means SUPER_ADMIN in auth and sponsor-ads.
- **Jobs:** `/api/v1/internal/jobs/auth-cleanup` (X-Job-Secret plus loopback), `/api/internal/jobs/auto-alpha` (Bearer CRON_SECRET, 15-minute crontab) and `/api/v1/internal/jobs/ads-*`, vs one `/api/internal/jobs/tick` every minute. The platform tick also schedules `ads-lifecycle`/`expireEndedAds`, but sponsor-ads D3 has no ENDED status and no cron.
- **Uploads:** a separate `POST /files` plus `attachFile` (platform D8) vs inline multipart in check-in, leave, SPP proof and top-up.
- **Media settings:** selfie retention 90 vs 180 days; selfie 640 px/q70 vs 1280 px/q80; banner 1200×600 at 2:1 vs ≤ 2048 with a 600×200 minimum.
  -> FIX: Use the platform design as the base, with these changes:
- `defineRoute(contract)`, where the contract carries `action` from the auth POLICY map, which keeps the status and mustChangePassword gates.
- One ERROR_CODES registry.
- Super admin without `schoolId` returns 400, except on `/platform/*` cross-school endpoints.
- Path prefixes `/auth` `/me` `/student` `/school` `/sponsor` `/platform`: rename attendance `/admin/attendance`→`/school/attendance`, and auth/sponsor `/admin/*`→`/platform/*`.
- One tick with a job registry (auth-cleanup, auto-alpha, files, ads); drop ads-lifecycle.
- Uploads: inline multipart for single-use evidence (selfie, leave attachment, SPP proof, top-up proof). It is atomic and leaves no orphans, and zod v4 `z.file()` documents it in OpenAPI. Keep a separate upload only for AD_BANNER, because banners are reused across ads. This lets you drop `attachedAt`/FILE_TOO_OLD and limit orphan cleanup to banners.
- One image-profile table in `storage/policy.ts`.
- Selfie retention pending the client (default 90 days).

- [MEDIUM] (attendance map (Peta Lokasi): Izin/Sakit/Alpha markers cannot be drawn) The spec wants markers coloured Hadir/Izin/Sakit/Alpha, with a popup showing student, class, location and time.
- `/admin/attendance/map` returns only rows that have coordinates. Those are CHECKIN rows (HADIR/TERLAMBAT) and ADMIN corrections that kept the evidence.
- LEAVE (IZIN/SAKIT) and AUTO_ALPHA rows never have lat/lng, so three of the four legend colours never appear.
- TERLAMBAT has no colour in the spec.
- The popup's 'location' (a place name?) is undefined, and the backend deliberately does no geocoding.
- The spec says 'Google Maps verifies the check-in location'. The design verifies with a server-side haversine distance (D19); Maps is only used for display, in a frontend that is not part of this delivery. The client has not been told this.
  -> FIX: Ask the client. Proposed default:
- Capture optional `latitude`, `longitude` and `accuracy` on `POST /student/leave-requests` (new nullable LeaveRequest columns) and plot IZIN/SAKIT at the submit point.
- Return `unlocated{counts, items[]}` next to `points[]` for ALPHA, BELUM_ABSEN and leaves without a location, so the UI can list them.
- Popup location = coordinates, `distanceM` from the school and `accuracyM`. Reverse geocoding, if wanted, is done by the frontend Maps Geocoder.
- Legend = HADIR, TERLAMBAT, IZIN, SAKIT, ALPHA.
- Add 'haversine, not a Google API call' to the client Q&A.

- [MEDIUM] (sponsor ads: deep links are specified but have no target) The spec says Input Link 'supports deep links and external URLs'. The design allows DEEP_LINK only as `studenthub://<host>` with `DEEP_LINK_ALLOWED_HOSTS=["promo"]`, but no design defines a 'promo' screen, route or any in-app landing target. In practice DEEP_LINK cannot be used and sponsors can only give https links. What the client most likely means (opening Shopee, Tokopedia or WhatsApp) is not supported.
  -> FIX: Settle sponsor Q3 before Phase 4. Proposed default:
- DEEP_LINK = a URL whose scheme is in a list the SUPER_ADMIN manages (`PlatformSetting.deepLinkSchemes` JSON, e.g. ["shopee","tokopedia","whatsapp"]).
- Always reject javascript, data, file, intent, blob and http. Reject `studenthub` too until a concrete in-app screen exists.
- Manual review continues and shows the reviewer the scheme and host.
- Add `GET /sponsor/link-options` so sponsors see which schemes are allowed.
- Unit-test `validateAdTargetUrl` against the list.

- [MEDIUM] (delivery: the client has no practical way to test) The client will exercise the API only through /docs, and the only environment is production on the VPS.
- Production runs `migrate deploy` plus the super-admin CLI and nothing else; `db:seed` refuses to run in production.
- There is no Expo app, so every student flow must be driven by hand from the docs page: NISN login, multipart selfie check-in with GPS fields, SPP proof, ad impressions and clicks with event tokens.
- Accepting any phase first needs dozens of setup calls: school with geofence, academic year, term, active term, classes, subjects, students, activation, password change.
- Testing on production also pollutes real tenant data and the audit log.
  -> FIX: Add in Phase 0:
- A staging instance on the same VPS: PM2 app `studenthub-staging` on free port 3021, database `studenthub_staging`, its own storage root, /docs behind Basic auth. The same workflow deploys it before production.
- `pnpm db:seed:demo`: idempotent; refuses any database name not ending in `_staging` or `_dev`; demo password taken from env, never from code. It creates:
  - 2 schools, one WIB and one WIT, with geofences;
  - academic year 2026/2027 with an active Ganjil term, classes and subjects;
  - about 30 active students and national holidays;
  - invoices, and one approved sponsor with a balance and live ads.
- Put example request bodies in OpenAPI `examples`: coordinates inside the demo geofence and a sample JPEG.
- Confirm that Scalar can send multipart file fields.

- [MEDIUM] (region reference data (Province/City): source not named) Province and City are seeded 'through migrations', but no dataset or version is named. School creation (`provinceCode`/`cityCode` foreign keys), ad targeting by province or city, and the province click breakdown all depend on it, so this blocks Phase 1. Kemendagri codes changed after the 2022 Papua splits (38 provinces), and city lists differ between sources.
  -> FIX: - Pin one source: the latest Kepmendagri kode wilayah, for example the MIT-licensed cahyadsn/wilayah dataset.
- Generate the idempotent `INSERT … ON DUPLICATE KEY UPDATE name` migration with a committed script, `scripts/gen-regions-migration.ts`.
- Add a test asserting 38 provinces, the expected kabupaten/kota count, the formats `^\d{2}$` and `^\d{2}\.\d{2}$`, and that every city's province exists.

- [MEDIUM] (academic: year-end promotion (defer) and its rollover trap) Promotion (`POST /school/promotions/preview`, `POST /school/promotions`, `planPromotion` with warnings, overrides and a School row lock) is not in the spec and is not needed before July 2027.

The activation rules still make the rollover a trap today. Auth rules 15 and 18 and academic rules C2 and C5 require an ACTIVE student's class to be in the active term's academic year, and they re-check this on every PATCH. As soon as an admin makes a 2027/2028 term active, every ACTIVE student becomes 'incomplete', and any biodata edit returns 422 until all classes are moved.
  -> FIX: Defer the promotion endpoints: remove them from Phase 3 and log a backlog item due before 2027-07.

Change these now:
- Check 'class is in the active year' only at activation or reactivation and on an explicit class change, not on every PATCH.
- `PUT /school/active-term` warns with the number of ACTIVE students still in old-year classes.
- Until promotion ships, mid-year moves use a `currentClassId` change on the student.

- [MEDIUM] (platform push: over-built for this delivery (defer)) Push is designed as an outbox with several competing dispatchers:
- a SENDING status, `pushClaimId`, `pushLockedUntil` lease and recovery, and `UPDATE … LIMIT` claims;
- a PushTicket table and a push-receipts job;
- merging of admin notifications (N5: JSON_SET plus moving `createdAt`).

But D29 requires a single PM2 fork process, so an in-process mutex already serialises dispatch. No Expo/EAS project exists yet, so production will run `PUSH_TRANSPORT=log`. Admins never receive push; they poll.
  -> FIX: Defer:
- the PushTicket model and the push-receipts job;
- the SENDING status and the claim and lease columns;
- N5 merging (insert one admin notification per event; the queue endpoints give the counts).

Keep for v1:
- `pushStatus` PENDING/SENT/FAILED/SKIPPED, `pushAttempts` and `pushNextAttemptAt`;
- a dispatcher run from the tick plus the `after()` kick, behind an in-process mutex;
- DeviceNotRegistered on the send ticket sets the session's token to NULL;
- log, memory and expo transports.

Add receipts once the EAS project exists and volume justifies it.

- [MEDIUM] (files: PDF support (cut)) PDF handling is inconsistent between designs and costly:
- attendance D23: images only for leave attachments;
- sponsor-ads: images only for top-up proofs;
- academic D15: accepts raw PDFs, unsanitised, served as a download;
- platform S3: rebuilds PDFs with pdf-lib, which is unmaintained (strips /Annots and /AA, checks encryption and page count), plus a `pageCount` column and fixtures.

The spec never mentions PDFs, and every mobile banking app can share a screenshot.
  -> FIX: Cut PDFs from v1.
- Accept JPEG, PNG and WebP only for every file kind. Anything else returns 415 with 'Unggah foto/tangkapan layar (JPEG/PNG)'.
- Drop pdf-lib, `rebuildPdf`, `StoredFile.pageCount` and the PDF tests.
- Revisit only if the client says yes to academic Q6, sponsor Q6 or attendance Q4.

- [MEDIUM] (attendance anomaly detection: more than v1 needs (defer part)) The spec only asks that admins can detect location anomalies. The design has:
- 12 severity-graded flags;
- in-transaction retro-flagging of other students' rows with JSON_ARRAY_APPEND, plus a day-close SQL sweep that does the same job, so two code paths set one flag;
- IMPOSSIBLE_TRAVEL measured against rejected attempts;
- DUPLICATE_SELFIE, a sha256 search across all dates;
- IDENTICAL_COORDINATES and a DEVICE_CHANGED lookback;
- an anomaly-review workflow (SCR-2 columns plus an endpoint).
  -> FIX: Keep for v1:
- the hard rejections (mock location, stale fix, accuracy, geofence), logged to CheckInRejection; 'tried from 3 km away' is the most useful signal;
- the flags computed from the request alone: GEOFENCE_TOLERANCE, LOW_ACCURACY, PERFECT_ACCURACY, DEVICE_SESSION_MISMATCH, STALE_FIX, CLOCK_SKEW;
- SHARED_DEVICE through the day-close sweep only, with no retro-flag inside the transaction;
- `hasAnomaly` and the anomalies list endpoint.

Defer IMPOSSIBLE_TRAVEL, IDENTICAL_COORDINATES, DUPLICATE_SELFIE, DEVICE_CHANGED and the review endpoint with its SCR-2 columns. Admins fix wrong records with the correction PUT.

- [LOW] (admin dashboard stat cards: split across endpoints) The four spec stat cards come from three endpoints under three prefixes: `/school/stats/academic`, `/school/stats/billing` and `/admin/attendance/stats/today`. 'Total Siswa aktif/nonaktif' is not defined for DRAFT, GRADUATED and MOVED students.
  -> FIX: Add `GET /school/dashboard/summary` (SCHOOL_ADMIN; SUPER_ADMIN with `schoolId`), which runs the existing domain queries in parallel and returns:
- `students{active, inactive, draft}`, where nonaktif = INACTIVE and GRADUATED/MOVED are excluded;
- `attendanceToday{presentPct, present, absent, notYet, isSchoolDay}`;
- `reportCards{termLabel, studentsWithGrades, activeStudents}`;
- `billing{studentsNotFullyPaid, pendingVerification}`.

Keep the per-domain endpoints for drill-down, and confirm the nonaktif definition with the client.

- [LOW] (sponsor analytics: device breakdown) The spec shows a Mobile/Desktop/Tablet breakdown, but clicks only come from the Expo student app, so Desktop will always be about 0%. The click body's `deviceType` enum (PHONE, TABLET, DESKTOP, TV, UNKNOWN) does not match the schema's `DeviceType` (MOBILE, TABLET, DESKTOP), and there is no UNKNOWN bucket.
  -> FIX: Make the request enum match the schema: PHONE→MOBILE, TABLET→TABLET, DESKTOP and TV→DESKTOP, missing→MOBILE. Alternatively, add UNKNOWN at the end of the enum. Tell the client that Desktop stays at 0 unless a web student portal is added.

- [LOW] (auth, platform and academic: features with no consumer yet (defer)) Nothing in this backend-only delivery would use these yet:
- web cookie transport with HMAC CSRF: there is no dashboard UI, and auth D2 tells docs testers to log in as platform=ANDROID;
- the X-App-Version / 426 gate: there is no app;
- the import credential-XLSX export;
- announcement scheduling (SCHEDULE mode plus a publisher job), post-publish edit (`editedAt`) and `readCount`;
- the report-card homeroom note and homeroom-teacher snapshot;
- `POST /school/classes/{id}/subjects/copy`.
  -> FIX: Move these to the dashboard/frontend phase:
- Cookie transport and CSRF: keep the Principal/transport abstraction so they plug in later; until then WEB login returns Bearer tokens too.
- App-version gate: only require the Expo app to send the header from its first release.
- Credential sheet: return credentials once as JSON with no-store.
- Announcements: keep only DRAFT → PUBLISHED → CANCELLED (retract).
- Homeroom note and teacher snapshot, and the class-subject copy endpoint.

Keep the sick/permitted/absent count snapshot on report cards; it is cheap and a standard rapor section.

- [LOW] (sponsor ads: extras outside the spec (cut or defer)) These are not in the spec and nothing would use them yet:
- `GET /admin/ads-overview` (platform KPIs);
- `POST /admin/sponsors/{id}/members` (several logins per sponsor);
- the REFUND ledger path (its meaning is still client question Q5);
- the daily `ads-reconcile` job;
- the `ads-banner-gc` job, which duplicates the platform's `files-orphan-cleanup`.
  -> FIX: - **Cut** `ads-banner-gc`; the generic orphan cleanup already handles AD_BANNER files.
- **Defer** ads-overview, sponsor members and REFUND (keep TOPUP, CLICK_CHARGE and ADJUSTMENT).
- **Replace** the reconcile job with integration tests asserting `balance == last balanceAfter == Σ amount` and that rollups equal the raw clicks. Add the job later only if drift is ever seen.


