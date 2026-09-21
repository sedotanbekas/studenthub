# REVIEW: consistency

SUMMARY: Consistency and integration review of the five domain designs against the proposed schema. I only read the designs; nothing was written. I checked one fact in the client's other app, lims-sotoy: its `src/lib/db.ts` (C:\Users\UseR\Documents\GAWEAN\MEDIALAB\lims-sotoy\src\lib\db.ts) sets `connectionLimit` but no `initSql`/`time_zone`.

Each domain design works on its own. Put together, they don't fit yet:

1. **Designed twice, with different contracts.** These features have two owners:
   - student create/activate/import/status/password reset (auth vs academic);
   - sponsor account admin and PlatformSetting (auth vs sponsor-ads);
   - school settings (auth vs attendance vs academic). The attendance version lets a SCHOOL_ADMIN edit the geofence and timezone, which contradicts auth D19;
   - push-token endpoints;
   - file upload (a separate two-step upload in platform vs inline multipart in attendance, academic and sponsor);
   - cron/jobs (secret, header, path, stale window, retention and the list of jobs all differ).
2. **Shared building blocks exist in 3–4 incompatible versions:** route wrapper/authorization, school-scope resolution, error class and codes, the transaction helper, audit writer, time module, rate limiter and CSRF.
3. **Cross-domain flows have gaps:**
   - notifications bypass the platform write path in the payment and report-card flows;
   - the low-balance notification is sent after commit instead of inside the transaction;
   - three NotificationType values are missing from `categoryForType`;
   - `expireEndedAds` is called by platform but does not exist in sponsor-ads;
   - nobody owns Holiday CRUD;
   - `activatedAt` is not set on the auth creation and import paths.
4. **Locking:** several domains lock the School or SchoolClass row with `FOR UPDATE`, or run long bulk transactions. Every child-row insert takes a shared lock on its parent row for the foreign-key check, so these collide with check-ins, audit writes and clicks. The morning check-in window can hit deadlocks and lock-wait timeouts.

The merged schema change list is given as 5 findings with area "schema-merge". SM-1 lists the conflicting requests that need a decision first: dropping `tokenVersion`, when `activeNisn` is claimed, `purgedAt` vs `deletedAt`, `Payment.paidDate`, the `DeviceType` mapping, `CheckInRejectReason` names, and use of `skipDuplicates`. The others list the additive changes per prisma file, plus the combined set of CHECK constraints and seed rows. Since nothing is deployed yet, all of it should go into the single init migration.

- [HIGH] (transactions-locking) There is no global lock order. Several designs use FOR UPDATE on parent rows that busy tables reference by foreign key, and InnoDB takes a shared lock on the parent row for every FK check on a child INSERT.

(1) Promotion (academic D19/D4) holds `School ... FOR UPDATE` for up to 60 s. During that time every insert with a schoolId FK in that school blocks:
- Attendance and StoredFile on check-in
- AdClick
- Invoice
- AuditLog (every `writeAudit`)
A check-in already holds `Student FOR UPDATE` (attendance D25) and then waits for the School shared lock. Meanwhile promotion's `updateMany` needs that Student row. The result is a deadlock (P2034) or a lock-wait timeout, right in the morning check-in window.

(2) Grade entry and publish lock `SchoolClass FOR UPDATE` (academic E4/E8). Check-ins insert Attendance with a classId FK, so they queue behind grade transactions for that class.

(3) Bulk SPP generation (academic F8) is one 60 s transaction with up to 3000 Invoice inserts. It keeps shared locks on up to 3000 Student rows until commit. Any `Student FOR UPDATE` on those students has to wait for the whole run: check-in, leave approval and the auth NISN claim.

(4) Each design has only a partial lock order:
- academic: School→SchoolClass→ReportCard and Student→Invoice→Submission→Payment→DocumentCounter
- attendance: Student→LeaveRequest→Attendance
- sponsor: Sponsor→TopUpRequest
- auth: the NISN claim locks another school's Student row by activeNisn
  -> FIX: 1. Publish one lock-order table in `src/lib/tx.ts` and have every domain follow it: SchoolClass → Student (ids ascending) → LeaveRequest → Attendance → ReportCard → Invoice (ascending) → PaymentSubmission → Payment → DocumentCounter. Separately: Sponsor → Ad/TopUpRequest → AdDailyStat. Notification and AuditLog inserts always come last.
2. Never `FOR UPDATE` a School or SchoolClass row as a mutex. Use dedicated lock rows instead, for example a `Mutex(key)` table or a JobRun-style claim keyed `promotion:<schoolId>` or `grades:<termId>:<classId>`. Alternatively rely on ReportCard row locks plus the unique keys.
3. Split bulk invoice generation into transactions of at most 200 students. Each chunk locks the counter, re-checks existing slots and inserts. The unique period slot keeps it idempotent, and numbering stays gapless.
4. Add integration tests where a check-in runs concurrently with a promotion or a bulk invoice run. The check-in must finish in under 2 s.

- [HIGH] (cross-domain-flows/notifications) Tracing the four flows end to end shows the notification step has no consistent owner or signature.

1. **Leave approval:** attendance `approveLeave(input, session, deps{clock,storage})` says it writes LEAVE_APPROVED "push", but it names no call into the platform. Platform `notifyStudents(tx, ids, e, ctx)` needs `ctx.defer` for the push kick, and attendance deps have no defer. LEAVE_SUBMITTED to admins must also go through platform merging (N5).
2. **Payment approval:** academic `approveSubmission(scope,id,input,now)` writes Payment and receipt, then calls its own `insertNotifications(tx, rows)`. That bypasses four things:
   - `initialPushStatus`: the schema default PENDING would queue pushes to admins;
   - PAYMENT_SUBMITTED merging: academic sends to up to 50 admins directly (MAX_ADMIN_NOTIFY);
   - `previewText`;
   - the kick.
3. **Ad click:** sponsor `recordClick(session,input,now)` notifies LOW_BALANCE **after commit** using `detectBalanceAlert`. That contradicts platform D7/N10, which notify inside the transaction using `crossedBelow`. An after-commit alert is lost if the process crashes. There are two threshold constants (LOW_BALANCE_THRESHOLD_RP and LOW_BALANCE_THRESHOLD_RUPIAH), and `adjustBalance`/REFUND never check the threshold.
4. **Report card publish:** `publishReportCards(scope,input,now)` has the same bypass as flow 2.

In addition, platform N1 `categoryForType: Record<NotificationType,…>` has no entries for ATTENDANCE_CORRECTED, INVOICE_VOIDED or PAYMENT_VOIDED, so typecheck fails once those enum values are added. Their deep-link screens are also undefined.
  -> FIX: 1. Make the platform the only write path: `notifyStudents` / `notifySchoolAdmins` / `notifySuperAdmins` / `notifySponsorMembers(tx, …, e, ctx)`. Delete academic `insertNotifications`, and move billing texts into `notifications/templates.ts`.
2. Adopt platform D33 in every domain service: `(input, ctx: ActionContext)`. Replace attendance `deps.clock`, academic `now` and sponsor `session` with `ctx.now` and `ctx.actor`, and derive the school scope from `ctx.actor` inside the service.
3. Low balance: evaluate it inside every charge, adjustment and refund transaction. Keep `detectBalanceAlert` (it returns LOW or EXHAUSTED) as the only pure function, drop `crossedBelow`, and keep one threshold constant.
4. Add N1 rows:
   - ATTENDANCE_CORRECTED → student, STUDENT_AFFAIRS, screen `attendance`;
   - INVOICE_VOIDED and PAYMENT_VOIDED → student, FINANCE, screen `invoice`.
5. Add one integration test per flow with DEFER_MODE=inline. It asserts the domain row, the Notification row with the right pushStatus, and the kick. A forced rollback must leave neither row behind.

- [HIGH] (students-ownership) Student management is designed in full twice, and the two versions disagree.

The two versions are auth-tenancy (`/students*`, rules 14–20, `src/lib/students/*`) and academic-spp (`/school/students*`, section C, `src/lib/academic/students/*`).

- **Paths:**
  - `/students`, `/students/{id}/activate|status`, `/students/import` vs `/school/students`, `/school/students/bulk`, `/school/students/:id/activate|status|reset-password`.
  - Password reset also exists at `POST /users/{id}/reset-password`.
- **`activate=true` with missing data:**
  - auth (D15) returns 422 and writes nothing;
  - academic creates a DRAFT and returns `missingForActivation`.
- **NISN claim timing:** see SM-1(b). On disclosure, auth shows the holding school's name to SUPER_ADMIN; academic never shows it.
- **Import:**
  - auth: multipart XLSX/CSV, up to 1000 rows, all-or-nothing, with a credential sheet;
  - academic: JSON, up to 500 rows, one transaction per row, partial success allowed.
- **Status transitions:**
  - auth allows GRADUATED→MOVED; academic does not;
  - academic voids future invoices on MOVED; auth does not;
  - academic increments tokenVersion, which auth drops.
- **Validation constants:**
  - minimum age 5 vs 4;
  - minimum address length 10 vs 5;
  - phone regex `8[1-9]\d{6,10}` vs `8\d{7,11}`;
  - name rule 3–100 characters vs a Unicode regex allowing 2–100;
  - temporary-password alphabet lowercase vs mixed case;
  - NISN editable by SUPER_ADMIN after DRAFT (auth) vs never (academic).
- **Error codes and function names:**
  - ACTIVATION_INCOMPLETE vs STUDENT_INCOMPLETE;
  - NISN_ALREADY_IN_SCHOOL vs NISN_TAKEN_IN_SCHOOL;
  - `getActivationGaps` vs `activationMissingFields`;
  - `claimNisn(tx, student, now)` vs `claimNisn(tx, nisn, schoolId, actor)`.
- **Missing on auth's paths:** create and import take no `sppAmount` and never set `activatedAt`. Attendance auto-ALPHA and the today card use `activatedAt` for eligibility.
  -> FIX: 1. Give students one owner, `src/lib/students/`. Use the auth design as the base, since it covers NISN claim and release, session revocation and import safety. Expose it at `/api/v1/school/students*`, following the platform path convention.
2. Merge in from academic:
   - the `sppAmount` field;
   - a billing-owned `voidFutureInvoicesForStudent(tx, …)` hook, called on MOVED and INACTIVE;
   - the search rules (LIKE escaping, NIS/NISN prefix match);
   - the read-only student profile.
3. Keep one `STUDENT_TRANSITIONS` table (including GRADUATED→MOVED), one constants file, one activation-gap function and one set of error codes.
4. Every path into ACTIVE sets `activatedAt` when it is null: create, import `createMany`, activate and reactivate.
5. Password reset goes only through auth `adminResetPassword`, behind a single endpoint.
6. Ask the client whether bulk import should be XLSX (friendlier for schools) or JSON.

- [HIGH] (sponsor-accounts-ownership) Sponsor account administration and PlatformSetting are designed by both auth-tenancy (rules 22–23, `sponsors/sponsor-account-service.ts`, `platform/settings-service.ts`) and sponsor-ads (rules 1–2 and 25, `sponsors/sponsor-service.ts`, `ads/settings-service.ts`).

1. **Create sponsor:** both define `POST /admin/sponsors`, with incompatible bodies and responses.
   - auth: body `account{name,email,initialPassword?}` plus `approveImmediately`; response `{sponsor,user,temporaryPassword?}`.
   - sponsor-ads: body `login{name,email,initialPassword}` with the password required; response `{sponsor{id,status},userId}`.
2. **Approve:** auth takes `note?`; sponsor-ads takes no body.
3. **Adding sponsor users:** auth adds them via `POST /admin/users` (role SPONSOR); sponsor-ads via `POST /admin/sponsors/{id}/members`.
4. **Platform settings:** PlatformSetting is editable through both `/admin/platform-settings` and `/admin/settings/ads`. The sponsor-ads service caches the settings, and writes through the other endpoint would not invalidate that cache.
5. **PENDING sponsor capabilities conflict:**
   - auth D20 says PENDING and SUSPENDED sponsors are read-only, and POLICY D8 defaults SPONSOR actions to APPROVED.
   - sponsor-ads D1 and rule 3 let a PENDING sponsor edit its profile, upload banners and create or edit DRAFT ads.
   - With both gates in place, PENDING sponsors are blocked at the route gate, contrary to the sponsor-ads design.
  -> FIX: 1. The sponsor-ads design owns `src/lib/sponsors/*`: account creation, transitions and members. Auth supplies only the user primitives (`createUser(tx,…)`, hashing, temporary passwords).
2. Keep one super-admin route set with one body: `account{name,email,initialPassword?}`, where an omitted password is generated and returned once, plus `approveImmediately`.
3. Keep one PlatformSetting service and endpoint, and invalidate its cache on write.
4. Encode sponsor status gating once, in POLICY, generated from the sponsor-ads `assertSponsorCan` table:
   - reads: `sponsorStatuses [PENDING, APPROVED, SUSPENDED]`
   - drafts, banners and profile: `[PENDING, APPROVED]`
   - submit, resume and top-up: `[APPROVED]`
5. Correct the text of auth D20 to match.

- [HIGH] (school-settings) The school settings endpoints conflict, and one of them breaks a security rule.

- **Geofence privilege:** attendance defines `GET/PATCH /api/v1/admin/school/attendance-settings` for SCHOOL_ADMIN and SUPER_ADMIN. Its fields include latitude, longitude, geofenceRadiusM and timezone. Auth D19 deliberately limits those fields to SUPER_ADMIN, so that a school admin cannot widen the geofence to make remote check-ins look valid.
- **Duplicate bank settings:** academic `PUT /school/billing-settings` duplicates the bank fields of auth `PATCH /schools/{id}/settings`.
- **Validators disagree:** there are two, auth `validateSchoolConfig` (`schools/schedule-rules.ts`) and attendance `validateAttendanceSettings`. Only the attendance one enforces `startMinute + lateToleranceMinutes < checkInCloseMinute`, and SCR-6 adds that rule as a database CHECK. A PATCH that passes auth's zod validation can therefore fail at the CHECK and surface as a 500.
  -> FIX: 1. The schools domain owns the School row. Keep two endpoints:
   - `PATCH /school/settings` for SCHOOL_ADMIN and SUPER_ADMIN: the schedule minutes, tolerance, schoolDaysMask and bank fields;
   - `PATCH /platform/schools/{id}` for SUPER_ADMIN only: name, npsn, location, geofence and timezone.
2. Remove attendance's attendance-settings endpoint and academic's billing-settings endpoint.
3. Keep one pure validator that mirrors every School CHECK exactly. Attendance contributes its rules as imports into it.
4. Changes to timezone, dayEndMinute or schoolDaysMask should be audited and should document that existing attendance rows are not rewritten.

- [HIGH] (file-uploads) The platform (D8) makes upload a separate step: `POST /api/v1/files` returns a fileId, and domains attach it with the `attachFile(tx,…)` compare-and-set on `StoredFile.attachedAt`. Other domains ignore this.

- **Inline multipart instead of the upload step:**
  - attendance check-in (section 3.2) and leave create;
  - academic `POST /me/invoices/:id/submissions` (D15);
  - sponsor `POST /sponsor/topups` (D20).
  Each inserts its own StoredFile row. Banners have their own endpoint, `POST /sponsor/banners`.
- **Conflicting per-kind profiles (domain vs platform):**
  - Selfie: ≤5 MiB → 640 px JPEG q70 (attendance) vs ≤4 MiB → 1280 px q80.
  - Banner: 2:1 ±2%, width ≥800 → 1200×600 (sponsor) vs ≥600×200, long side ≤2048.
  - Leave attachment: images only (attendance) vs image or PDF.
  - Top-up proof: images only → WebP (sponsor) vs image or PDF.
  - Payment-proof PDF: stored as-is after a `%PDF-` check (academic) vs rebuilt with pdf-lib.
- **Banner reuse conflict:** `attachFile` returns 409 FILE_ALREADY_ATTACHED, but sponsor rule 5 lets several ads reuse one banner. Banner cleanup is also designed twice: sponsor `ads-banner-gc` vs platform `files-orphan-cleanup`.
- **Selfie retention:** attendance keeps selfies 90 days, platform 180 days. Both `attendance-retention` and `maintenance-daily` purge them.
- **Duplicated machinery:**
  - four image pipelines and two magic-byte sniffers;
  - `sharp.concurrency` set to 1 in one design and 2 in another;
  - nginx `client_max_body_size` given as 6m, 8m and 12m.
  -> FIX: 1. Use the platform's two-step upload for every file kind: domain bodies become JSON with a `fileId` (JSON bodies are what zod validates and OpenAPI documents).
   - AD_BANNER attaches as shareable (`allowShared`), so several ads can use one file.
   - Attendance check-in becomes JSON with `selfieFileId` and `maxAgeMinutes=10`. A rejected attempt leaves the file unattached; it can be reused, and the orphan job deletes it within 24 h.
2. Keep all per-kind limits in `storage/policy.ts`, using the stricter domain values:
   - selfie 640 px q70;
   - banner 2:1 at 1200×600;
   - leave attachments and top-up proofs images-only unless the client allows PDF. Ask this as one question; attendance Q4, academic Q6 and sponsor Q6 all ask it;
   - any PDF that is accepted is rebuilt with pdf-lib.
3. Keep one selfie-retention constant (confirm with the client once, because of UU PDP) and purge only in `maintenance-daily`.
4. Drop `ads-banner-gc`, keep one image pipeline, and set one nginx body limit (12m).

- [HIGH] (jobs-cron) The job designs are not reconciled.

- **Paths:**
  - `/api/internal/jobs/*` in platform and attendance;
  - `/api/v1/internal/jobs/*` in auth (`auth-cleanup`) and sponsor (`ads-banner-gc`, `ads-reconcile`).
  The nginx rule `location ^~ /api/internal/` does not cover `/api/v1/internal/`, so sponsor's jobs are reachable from the internet, protected only by the secret.
- **Authentication:**
  - `X-Job-Secret` + JOB_SECRET, 404 on mismatch (platform);
  - `Authorization: Bearer` + CRON_SECRET, 401 (attendance). A Bearer header would also be parsed by `defineRoute` as an access token;
  - `X-Job-Secret` plus a loopback check (auth).
- **Cadence:** a single tick every minute (platform) vs attendance's own cron every 15 minutes.
- **Claim logic:**
  - attendance `claimJobRun` → CLAIMED/DONE/BUSY, stale after 10 min, unlimited retries;
  - platform `runKeyedJob`, stale after 15 min, at most 5 attempts.
- **Function signatures:** platform calls `attendance.runAutoAlphaForSchool(schoolId, ymd, ctx)`, but attendance defines `runAutoAlphaJob({now, schoolId?, date?, budgetMs})`. Catch-up is 7 days in attendance vs 3 in platform.
- **Jobs missing from `dueJobs`:**
  - auth-cleanup;
  - attendance-retention, including the CheckInRejection deletion after 90 days;
  - ads-reconcile.
- **Phantom job:** `ads-lifecycle` calls `expireEndedAds(now)`, but sponsor-ads D3 has no ENDED status and no expiry cron.
- **Retention conflicts:**
  - dead sessions purged after 90 days (auth) vs 30 days (platform);
  - selfies 90 vs 180 days.
- **JobRun purge breaks analytics:** platform deletes JobRuns after 90 days. Attendance `meta.unclosedDates` (analytics, and trends up to 12 months) and `candidateCloseDates` read SUCCEEDED auto-alpha runs, so every month older than 90 days would show as unclosed.
  -> FIX: 1. Use one runner, the platform's: `/api/internal/jobs/{job}` only, `X-Job-Secret` with JOB_SECRET, 404 on mismatch, plus auth's loopback check. Internal routes do not go through `defineRoute`.
2. `dueJobs` covers:
   - push-dispatch, push-receipts and announcements-publish on every tick;
   - attendance-auto-alpha on every tick, per school, calling `runAutoAlphaForSchool(schoolId, ymd, ctx: JobContext)` wrapped around `closeSchoolDay`;
   - files-orphan-cleanup hourly;
   - maintenance-daily: auth cleanup with auth's retention constants, selfie purge, CheckInRejection deletion, notification retention and JobRun retention;
   - ads-reconcile daily at 18:00 UTC.
3. Delete `ads-lifecycle` and `ads-banner-gc`.
4. Use `runKeyedJob` everywhere, with one stale window (15 min), one attempt cap (5) and a 7-day auto-alpha catch-up.
5. Exclude `attendance-auto-alpha` rows from JobRun retention, or keep them at least 400 days.

- [HIGH] (http-pipeline-authz) The shared building blocks are each defined 3–4 times with incompatible signatures.

- **Route wrapper:** auth has `apiRoute({action, …, handler(ctx{req,principal,body,query,params,ip,now})})`, which authorises by POLICY action, including student/sponsor status and mustChangePassword. Platform has `defineRoute(contract{auth: Role[], allowPendingPasswordChange}, handler(input, ctx: ActionContext))`, which authorises by role only. Both claim a route-coverage test.
- **Identity type:** four shapes: auth `Principal`, platform `Actor{…sessionId,studentId}`, sponsor `Session`, academic `Actor{userId,role,schoolId,ip,userAgent}`.
- **School scope:** `resolveSchoolScope` exists in four places:
  - `tenant/scope.ts` (auth): branded type, read/write mode; SUPER_ADMIN reads without schoolId return all schools; for creates, schoolId goes in the body;
  - `common/scope.ts` (academic): returns `{schoolId, actor}`;
  - `auth/school-scope.ts` (attendance): returns a string;
  - platform H3: SUPER_ADMIN without schoolId gets 400, even for reads.
- **Errors:**
  - auth `DomainError(status, code, …)` vs platform `AppError(code, message, status, …)`, with a different argument order;
  - sponsor `AdsError extends Error`, which `mapError` would turn into a 500;
  - diverging codes: VALIDATION_ERROR vs VALIDATION_FAILED; CSRF_INVALID vs CSRF_FAILED; SCOPE_MISMATCH vs FORBIDDEN_SCOPE; SESSION_INVALID vs SESSION_REVOKED; STUDENT_READ_ONLY vs STUDENT_NOT_ACTIVE vs STUDENT_NOT_ELIGIBLE; SPONSOR_NOT_APPROVED vs ACCOUNT_PENDING_APPROVAL.
- **Audit and transactions:**
  - `writeAudit(tx, e)` vs `writeAudit(tx, e, ctx)`;
  - three `withTx` modules: `db/tx.ts`, `common/tx.ts` and `tx.ts`.
- **Policy actions:**
  - names diverge: `student.manage` vs `students.write`, `sponsor.analytics.read` vs `analytics.own`;
  - academic lets GRADUATED students pay arrears, which auth's ACTIVE-only default for student actions blocks.
  -> FIX: 1. One route contract: platform's `RouteContract` gets `action: Action` in place of `auth: Role[]`. `defineRoute` calls auth `getAuth` and then `authorize(principal, action)`.
2. One identity type: `Actor` = auth `Principal`.
3. One `resolveSchoolScope(actor, requested, mode)` returning the branded `SchoolScope`:
   - schoolId always comes from the query;
   - SUPER_ADMIN without a schoolId gets 400, except on explicit `/platform/*` cross-school lists.
4. One `AppError(status, code, message, details?)` that every domain error extends, and one `ERROR_CODES` registry, with auth's names used for auth codes.
5. One `withTx`, and one `writeAudit(tx, e, ctx)`.
6. POLICY names follow `<domain>.<verb>` in the singular; student billing and read actions list `studentStatuses: [ACTIVE, GRADUATED]`.

- [HIGH] (school-calendar) No domain owns Holiday CRUD, although both attendance correctness and check-in availability depend on it.

- **No holiday endpoints anywhere:** the auth schools domain, academic (years, terms, classes, subjects) and platform define none. Attendance only exposes `onCalendarChanged(scope, from, to, kind)`, "called by the school domain". Without these endpoints, neither a school holiday nor a national holiday (`schoolId` NULL, managed by the super admin) can be entered, and auto-ALPHA marks every student ALPHA on those days.
- **Not atomic:** `onCalendarChanged` takes no `tx`, so the holiday write and the attendance cleanup are not in one transaction.
- **New schools cannot run attendance:** attendance D7 requires a Term covering the date, and `SchoolClass.academicYearId` is required. A freshly provisioned school, as in the auth E2E (school → admin → import → login), cannot activate students: the "class present" gap cannot be met without a class, which needs an academic year. Any check-in is also rejected as NOT_SCHOOL_DAY/OUTSIDE_TERM. No design states the onboarding order.
- **Term edits are silent:** academic term edits and deletes never call the calendar hook.
  -> FIX: 1. The academic-calendar module (academic `terms/`) owns holidays:
   - `GET/POST/PATCH/DELETE /school/holidays` for SCHOOL_ADMIN (own school);
   - `/platform/holidays` for SUPER_ADMIN (national).
   Validation: `startDate ≤ endDate`, span limited.
2. Every holiday write calls `onCalendarChanged(tx, schoolId|null, from, to, kind, ctx)` inside the same transaction.
3. Term shrink or delete either calls the hook or is blocked while attendance rows exist in the range being removed.
4. Document the onboarding order: school → academic year → terms → active term → classes → subjects and mapping → students → holidays. Make E2E seeds follow it.
5. Return a setup hint when a check-in fails with OUTSIDE_TERM.

- [HIGH] (schema-merge) Conflicting schema change requests (SCRs) that must be decided before the single init migration is written:

(a) `User.tokenVersion`: auth SCR-1 drops it (D4, the AuthSession row is checked on every request). Academic D16, C6 and C7 and their tests still increment it.

(b) `Student.activeNisn` has three meanings:
- the base schema says it equals the NISN for DRAFT too;
- auth D14 claims it at activation (NULL while DRAFT or MOVED);
- academic C3 claims it at creation.

(c) Selfie purge column: attendance SCR-4 adds `StoredFile.purgedAt` + `@@index([kind, createdAt])`; platform adds `deletedAt` + `@@index([kind, deletedAt, createdAt])` for the same purpose.

(d) Academic SCR-7 changes `Payment.paidAt` to `paidDate @db.Date`. `Invoice.paidAt` must stay an instant.

(e) `DeviceType` is MOBILE|TABLET|DESKTOP, but the sponsor click API accepts PHONE|TABLET|DESKTOP|TV|UNKNOWN. Its `mapDeviceType` test includes TV and missing values, which have no enum target.

(f) `CheckInRejectReason` values LOW_ACCURACY and STALE_LOCATION differ from the 422 codes GPS_ACCURACY_TOO_LOW and LOCATION_STALE. LOW_ACCURACY is also an anomaly flag on accepted check-ins, with a different threshold (>50 m instead of >100 m).

(g) Academic D12 shows that `createMany({skipDuplicates})` is INSERT IGNORE, which can silently drop rows that fail a CHECK or FK. Attendance auto-ALPHA and platform N4 notification fan-out still rely on it.
  -> FIX: (a) Drop `tokenVersion`. Academic's status-change and reset paths call auth `revokeAllSessions(tx, userId, reason, exceptSid?)`.

(b) Adopt auth D14: NULL while DRAFT or MOVED, claimed at activation. Rewrite the doc comment and academic C3/C4.

(c) Keep `deletedAt` and `[kind, deletedAt, createdAt]`; drop `purgedAt` and `[kind, createdAt]`.

(d) Accept `paidDate` and the index `[schoolId, paidDate]`.

(e) Make the API enum identical to the DB enum: MOBILE|TABLET|DESKTOP, optional, default MOBILE. Alternatively append UNKNOWN now; decide before the init migration either way.

(f) Name the enum values after the error codes: OUTSIDE_GEOFENCE, GPS_ACCURACY_TOO_LOW, MOCK_LOCATION, LOCATION_STALE, INVALID_LOCATION.

(g) Use `skipDuplicates` only where rows cannot violate a CHECK or FK. Compare inserted and planned counts (auto-ALPHA `alphaCreated` + `leaveCreated` against eligible) and log any mismatch.

Fold every SCR into the single init migration. The "append enum values at the end" rule applies only after the first production deploy.

- [MEDIUM] (auth-transport-session) The auth transport and session contracts disagree between the auth and platform designs.

- **CSRF:**
  - auth D6: a per-session HMAC token (`X-CSRF-Token`, `CSRF_SECRET`, a readable `__Host-sh_csrf` cookie, refresh cookie SameSite=Strict on `/api/v1/auth`);
  - platform D17/H7: Origin and Sec-Fetch-Site checks only, no token.
- **Env:**
  - the platform CI workflow env and the VPS `.env` template lack `CSRF_SECRET` (auth rule 27: required at startup) and `AD_EVENT_SECRET` (sponsor D9: checked at startup);
  - attendance expects `CRON_SECRET`;
  - the e2e step runs `next start`, which is production mode, so either boot fails or the first login fails.
- **Push token:**
  - endpoints `PUT/DELETE /auth/push-token` (auth) vs `/me/push-token` (platform);
  - platform wants login to accept `expoPushToken`, and auth's login schema lacks it.
- **deviceId:**
  - auth `/^[A-Za-z0-9._:-]{8,100}$/`, optional;
  - attendance check-in allows `[A-Za-z0-9_-]` only and requires STUDENT mobile sessions to carry a deviceId;
  - an id with `.` or `:` accepted at login would fail check-in validation.
- **Check-in rate limit:** auth `CHECK_IN {6 per 5 min}` vs attendance `{10 per 10 min}`, with a test expecting 429 on the 11th attempt.
- **Client IP:** auth falls back to the last X-Forwarded-For hop; platform ignores XFF entirely.
  -> FIX: 1. CSRF: decide once. Recommended: keep auth's token-bound CSRF (it resists cookie injection from a subdomain) and have `defineRoute` call `verifyCsrf`.
2. One zod env schema listing JWT_ACCESS_SECRET, CSRF_SECRET, JOB_SECRET, AD_EVENT_SECRET (each at least 32 bytes and all distinct), APP_ORIGIN, DATABASE_URL, STORAGE_ROOT, PUBLIC_MEDIA_BASE_URL, PUSH_TRANSPORT and DOCS_BASIC_AUTH. Add dummy values to the CI workflow and the `.env` template. No CRON_SECRET.
3. Push token: one endpoint, `/me/push-token`, allowed during a forced password change. Login accepts an optional `expoPushToken`.
4. deviceId: one shared zod schema, required at login for STUDENT on ANDROID or IOS.
5. One check-in limiter config in `rate-limit/limits.ts`.
6. Client IP from `X-Real-IP` only, since the app binds to 127.0.0.1.

- [MEDIUM] (time-timezone) Four time modules with incompatible APIs:

| Design | Module | API |
|---|---|---|
| attendance | `time/school-time.ts` | `toSchoolLocal` → `{date, minute, weekdayIdx}` |
| academic | `time/local-date.ts` | `todayLocal`, `localYear`; LocalDate is a string |
| sponsor | also `time/local-date.ts` | `localDate(instant, offsetMin): Date` (UTC-midnight Date), `wibDate` |
| platform | `time/zone.ts` | `localParts` → `{ymd, minuteOfDay, weekdayBit}` |

Academic and sponsor use the same file path with different exports.

Auth describes `src/lib/db.ts` as a lims clone. lims `db.ts` has no `initSql`/`time_zone` (verified), so platform D22's `SET time_zone='+00:00'` would be lost. Academic's DocumentCounter upsert writes `NOW(3)`, and `DEFAULT CURRENT_TIMESTAMP` columns would follow the server timezone.

The day buckets themselves are consistent:
- attendance, leave, invoice due date, transfer date and document year use the school's local date;
- clicks, impressions, analytics, top-up date and maintenance use WIB.
This is not documented per field anywhere.
  -> FIX: 1. Keep one pure module, `src/lib/time/zone.ts`:
   - string `LocalDate`;
   - `localParts`, `instantAtLocal`, `toDbDate`/`fromDbDate`, `addDays`, `diffDays`, `eachDate`, `monthRange`;
   - `wibDate(i) = localParts(i, 'WIB').ymd`;
   - one `TZ_OFFSET_MINUTES`.
   Delete the other three modules.
2. `db.ts` is the lims clone plus `initSql: "SET time_zone='+00:00'"`, with a boot assertion.
3. Ban `NOW()` in raw SQL; pass `ctx.now` instead.
4. In OpenAPI, state for every `YYYY-MM-DD` field which timezone it uses (school-local or WIB).

- [MEDIUM] (rest-paths-shapes) Path prefixes and response shapes are inconsistent across the designs.

- **What `/admin/*` means:**
  - in attendance it is SCHOOL_ADMIN: `/admin/attendance/*`, `/admin/leave-requests`, `/admin/students/:id/attendance`;
  - in auth and sponsor-ads it is SUPER_ADMIN: `/admin/users`, `/admin/sponsors`, `/admin/ads`, `/admin/topups`;
  - platform uses `/platform/*` for SUPER_ADMIN;
  - auth D26 uses flat paths: `/students`, `/schools`, `/audit-logs`.
- **Student-only data** is split between `/student/*` (attendance, leave, ads) and `/me/*` (academic invoices, report cards, payment info, student profile).
- **Stats:** `/admin/attendance/stats/today` vs `/school/stats/academic|billing`.
- **List payloads:**
  - auth `rows`; academic, sponsor and platform `items`; attendance a bare array;
  - meta `{total,page,limit}` vs `{…,totalPages}`;
  - sponsor errors use `fields` instead of `details`.
- **Role abbreviations clash:** auth uses SA = SUPER_ADMIN and SCA = SCHOOL_ADMIN; attendance and academic use SA = SCHOOL_ADMIN and SU = SUPER_ADMIN.
  -> FIX: 1. Adopt the platform convention everywhere:
   - `/student/*`: all STUDENT-only resources;
   - `/school/*`: SCHOOL_ADMIN, plus SUPER_ADMIN with `?schoolId=`;
   - `/sponsor/*`;
   - `/platform/*`: SUPER_ADMIN (schools, users, sponsors, ad review, top-ups, settings, holidays, job-runs, audit-logs);
   - `/me/*`: role-agnostic self only;
   - `/auth/*`, `/notifications/*`, `/files/*`, `/regions/*`.
2. Stats live under `/school/stats/{attendance-today,academic,billing}`.
3. Lists return `data: T[]` plus `meta` everywhere, matching the client's envelope rule.
4. Use full role names in every table and in the OpenAPI docs.

- [MEDIUM] (schema-merge) Merged additive changes, part 1 of 3: auth, school, student and report-card.

**auth.prisma**
- `User`:
  - remove `tokenVersion`;
  - add `@@index([role, isActive])`;
  - add `attendanceAnomalyReviews Attendance[] @relation("AttendanceAnomalyReviewer")`.
- `AuthSession`:
  - add `pushTickets PushTicket[]` and `@@index([deviceId, revokedAt])`;
  - doc comment: WEB = cookie, ANDROID/IOS = Bearer; deviceId is required for STUDENT mobile sessions (a service rule).
- `RefreshToken`: add `@@index([rotatedAt])` and `@@index([expiresAt])`.

**school.prisma**
- `School`: add `checkInRejections CheckInRejection[]` and `documentCounters DocumentCounter[]`.
- `SchoolClass`: add `homeroomTeacherName String? @db.VarChar(100)` and `classSubjects ClassSubject[]`.
- `Subject`: add `classSubjects ClassSubject[]`.
- New `ClassSubject {classId, subjectId, sortOrder Int @default(0) @db.SmallInt, createdAt; @@id([classId, subjectId]); @@index([subjectId])}`. The class relation cascades on delete; the subject relation is Restrict.
- Only if the client says yes to sponsor Q4: `enum SchoolLevel {SD SMP SMA SMK}` and `School.level SchoolLevel?`.

**student.prisma**
- `Student`:
  - add `sppAmount Int?` (NULL means use the bulk default, 0 means exempt);
  - add `checkInRejections CheckInRejection[]`;
  - rewrite the `activeNisn` doc comment per SM-1(b);
  - document `activatedAt` as the first activation instant, used for auto-ALPHA eligibility.

**report-card.prisma**
- `ReportCardGrade.score`: `Decimal @db.Decimal(5,2)` becomes `Int @db.UnsignedTinyInt`.
- `ReportCard`: add `homeroomNote String? @db.VarChar(1000)`, `homeroomTeacherNameSnapshot String? @db.VarChar(100)`, and `sickDays`, `permitDays`, `absentDays Int? @db.SmallInt`.
  -> FIX: 1. Apply these in the init migration.
2. Declare every new relation on both sides; otherwise `prisma validate` fails.
3. Add a CI step running `prisma validate` and `migrate diff` against an empty database.

- [MEDIUM] (schema-merge) Merged additive changes, part 2 of 3: attendance and billing.

**attendance.prisma**
- New `enum CheckInRejectReason {OUTSIDE_GEOFENCE GPS_ACCURACY_TOO_LOW MOCK_LOCATION LOCATION_STALE INVALID_LOCATION}` (names per SM-1f).
- New `model CheckInRejection`, append-only with no `updatedAt`:
  - fields: schoolId, studentId, `date @db.Date`, reason, `latitude`/`longitude Decimal(10,7)?`, `accuracyM Int?`, `distanceM Int?`, `isMocked Boolean?`, `deviceId VarChar(100)?`, createdAt;
  - indexes: `@@index([schoolId, date])`, `@@index([studentId, createdAt])`.
- `Attendance`:
  - add `anomalyReviewedAt DateTime?`, `anomalyReviewedById String?` and `anomalyReviewNote String? @db.VarChar(255)`, with relation "AttendanceAnomalyReviewer" (Restrict);
  - replace `@@index([schoolId, hasAnomaly, date])` with `@@index([schoolId, hasAnomaly, anomalyReviewedAt, date])`;
  - doc comments: `lateMinutes` counts minutes after startMinute; `anomalyFlags` uses the fixed code list in attendance §3.4 (MOCK_LOCATION is now a rejection reason, not a flag).
- `LeaveRequest`: add `@@index([schoolId, status, startDate])`.

**billing.prisma**
- `Invoice`:
  - add `invoiceNo String @db.VarChar(20)` with `@@unique([schoolId, invoiceNo])`;
  - name the submissions relation "InvoiceSubmissions" on both sides;
  - add `pendingSubmission PaymentSubmission? @relation("InvoicePendingSubmission")`.
- `PaymentSubmission`: add `pendingInvoiceId String? @unique` with relation "InvoicePendingSubmission" (Restrict).
- `Payment`:
  - replace `paidAt DateTime` with `paidDate DateTime @db.Date`;
  - add `receiptNo String @db.VarChar(20)` with `@@unique([schoolId, receiptNo])`;
  - replace the index `[schoolId, paidAt]` with `[schoolId, paidDate]`.
- New `enum DocumentKind {INVOICE RECEIPT}` and `model DocumentCounter {schoolId, kind, year Int @db.SmallInt, lastValue Int @default(0), updatedAt; @@id([schoolId, kind, year])}`.
- `InvoiceStatus` stays as is (no PENDING_VERIFICATION).
- Remove the doc note "bulk generation uses skipDuplicates".
  -> FIX: `invoiceNo` and `receiptNo` are NOT NULL. Every path that creates an invoice or payment must therefore allocate a number through `allocateDocumentNumbers`, and that includes seed data and integration-test factories. Add a guard test that no code under `src/**` calls `prisma.invoice.create` directly.

- [MEDIUM] (schema-merge) Merged additive changes, part 3 of 3: notification, sponsor and platform.

**notification.prisma**
- `NotificationType`: append in this order: `ATTENDANCE_CORRECTED`, `INVOICE_VOIDED`, `PAYMENT_VOIDED`.
- `PushStatus`: append `SENDING`.
- `Notification`:
  - add `pushNextAttemptAt DateTime @default(now())`, `pushClaimId String? @db.VarChar(36)`, `pushLockedUntil DateTime?` and `pushTickets PushTicket[]`;
  - replace `@@index([pushStatus, createdAt])` with `[pushStatus, pushNextAttemptAt]`;
  - add indexes `[pushClaimId]`, `[announcementId]` and `[userId, type, createdAt]`.
- `Announcement`: add `editedAt DateTime?`, `cancelledAt DateTime?` and `@@index([schoolId, status, createdAt])`.
- New `PushTicket`:
  - fields: `ticketId @unique VarChar(64)`, notificationId (Cascade), sessionId → AuthSession (Cascade), an `expoPushToken` snapshot, createdAt;
  - indexes on createdAt, notificationId and sessionId.

**sponsor.prisma**
- `SponsorLedgerEntry`: add `@@index([sponsorId, type, createdAt])`.
- `AdClick`: add `@@index([sponsorId, date, deviceType])` and `@@index([sponsorId, date, provinceCode])`.
- `DeviceType`: per the SM-1e decision.
- Doc comments:
  - `Ad.cpcAmount` is an estimate while DRAFT and a snapshot taken at every SUBMIT;
  - `Ad.submittedAt` is the compare-and-set token for review;
  - `AdStatus` has no ENDED (it is derived).
- Only if Q4 is yes: append `LEVEL` to `AdTargetScope` and add `AdTarget.level SchoolLevel?`.

**platform.prisma**
- `StoredFile`:
  - add `width`, `height` and `pageCount Int? @db.SmallInt`, storing the re-encoded output dimensions;
  - add `attachedAt DateTime?` and `deletedAt DateTime?`;
  - add `@@index([attachedAt, createdAt])` and `@@index([kind, deletedAt, createdAt])`.
- `JobRun`: add `attempts Int @default(1) @db.TinyInt`, `@@index([job, startedAt])` and `@@index([status, startedAt])`.
  -> FIX: 1. Update `categoryForType` and the notification templates in the same change that adds the three new NotificationType values.
2. Store only post-re-encode dimensions in the SmallInt `width`/`height` columns. A raw 25 MP upload can be more than 32767 px wide, which would overflow them.

- [MEDIUM] (schema-merge) Combined CHECK constraints and seed rows for the init migration.

**CHECK constraints**
- **User:** the role/scope matrix, plus `role<>'STUDENT' OR email IS NULL`.
- **School:**
  - `0<=checkInOpenMinute<startMinute<=checkInCloseMinute<=dayEndMinute<1440`
  - `startMinute+lateToleranceMinutes<checkInCloseMinute`
  - `geofenceRadiusM BETWEEN 50 AND 1000`
  - `lateToleranceMinutes BETWEEN 0 AND 120`
  - `schoolDaysMask BETWEEN 1 AND 127`
- **Date ranges:**
  - Holiday, Term, AcademicYear and LeaveRequest: `startDate<=endDate`
  - LeaveRequest: `DATEDIFF(endDate,startDate)<=30`
  - Ad: `startAt<endAt`
- **Attendance:**
  - CHECKIN rows require checkInAt, latitude, longitude and selfieFileId
  - AUTO_ALPHA implies status ALPHA
  - LEAVE implies status IZIN or SAKIT and a leaveRequestId
  - `(status='TERLAMBAT')=(lateMinutes BETWEEN 1 AND 720)`
- **Academic:**
  - ReportCardGrade: `score<=100`
  - Subject: `kkm BETWEEN 0 AND 100`
  - SchoolClass: `gradeLevel BETWEEN 1 AND 12`
- **Invoice:**
  - `amount>0`, `0<=paidAmount<=amount`, `periodMonth BETWEEN 1 AND 12`
  - UNPAID ⇒ paid=0; PARTIAL ⇒ 0<paid<amount; PAID ⇒ paid=amount; VOID ⇒ paid=0
- **Payment and PaymentSubmission:**
  - Payment and PaymentSubmission: `amount>0`
  - PaymentSubmission: `(status='PENDING')=(pendingInvoiceId IS NOT NULL)` and `pendingInvoiceId IS NULL OR pendingInvoiceId=invoiceId`
- **Other billing:**
  - Student: `sppAmount IS NULL OR sppAmount BETWEEN 0 AND 50000000`
  - DocumentCounter: `lastValue>=0`
- **Sponsor and ledger:**
  - Sponsor: `balance>=0`
  - Ledger: `amount<>0`, `balanceAfter>=0`, the sign rule per type, `(topUpRequestId IS NOT NULL)=(type='TOPUP')`, `(adClickId IS NOT NULL)=(type='CLICK_CHARGE')`
- **Ads:**
  - AdClick: `(billing='CHARGED')=(billableDate IS NOT NULL AND chargeAmount>0)` and `chargeAmount>=0`
  - Ad: `cpcAmount BETWEEN 100 AND 100000`
  - TopUpRequest: `amount>0`
  - AdDailyStat: all counters `>=0`
- **Targets:** exactly one target column set on AdTarget and on AnnouncementTarget.
- **PlatformSetting:** `defaultCpcAmount BETWEEN 100 AND 100000` and `minTopUpAmount>=10000`.

**Seed rows (idempotent migrations)**
- Province and City reference data.
- PlatformSetting row `id=1` with 500 and 100000 until the client answers Q1.

**Problems**
- The platform error mapping (H4) does not handle CHECK violations (MariaDB ER_CONSTRAINT_FAILED, errno 4025), so they come back as a generic 500.
- The ledger CHECK hard-codes REFUND as negative, which is still an open client question.
  -> FIX: 1. Write every zod and pure validator from the same constants as these CHECK constraints (see the school-settings finding).
2. `mapError` should recognise errno 4025 and log it with the constraint name as a bug. It should not return an anonymous 500.
3. Add one CI integration test per CHECK.
4. Get the REFUND answer from the client before the init migration.

- [LOW] (stats-definitions) Some statistic definitions don't line up between stat cards, analytics and the report card.

1. **"Klik Unik":** the KPI is `COUNT(DISTINCT userId)` for each sponsor and period, read from AdClick. The time series takes `uniqueClicks` from AdDailyStat, which counts per ad per day. The sponsor-wide daily value is therefore a sum over ads, so a student who clicked two ads counts twice. A one-day chart can then exceed the KPI for the same day.
2. **"Nilai Raport semester ini":** the numerator `studentsWithGrades` counts every report card in the term, including students who are now INACTIVE or MOVED. The denominator is `activeStudents`, so the card can exceed 100%.
3. **Class chart:** it returns `presentPct` (which includes late arrivals) and also `latePct`. The deck stacks Hadir, Izin, Sakit and Alpha, so stacking latePct as well would push the bar past 100%.
4. **Report-card attendance snapshot (academic E8):** it counts up to `min(term.endDate, today)`. Days that auto-ALPHA has not closed yet have no ALPHA rows, so absentDays is undercounted.
5. **Delta units:** attendance `deltaPp` is in percentage points, while sponsor `changePct` is a relative %. Both are valid choices but neither is labelled.
  -> FIX: 1. For the sponsor-wide daily series, compute unique clicks as `COUNT(DISTINCT userId) … GROUP BY date` from AdClick. The existing index `[sponsorId, date, userId]` covers this. Keep the rollup value only when an `adId` filter is given.
2. Restrict the report-card numerator to ACTIVE students.
3. Document that `latePct` is a subset of `presentPct`.
4. Cut the report-card snapshot at attendance `closedThrough` and return `unclosedDates`.
5. Label the units of `deltaPp` and `changePct` in OpenAPI.


