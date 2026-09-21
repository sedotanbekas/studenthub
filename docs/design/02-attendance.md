# Attendance domain design: Student Hub

This is a design only. I changed no files, ran no installs and connected to nothing. I read lims-sotoy (`kalender-kerja.ts`, `api-permission.ts`, `package.json`) to follow its conventions.

## 1. Decisions

| # | Decision | Justification |
|---|---|---|
| D1 | **Timezones use fixed offsets:** WIB=+420, WITA=+480, WIT=+540 minutes, applied with pure integer math on `getUTC*`. No date library. The IANA names (`Asia/Jakarta`, `Asia/Makassar`, `Asia/Jayapura`) are used only for display. A guard test checks the offsets against `Intl.DateTimeFormat`. | Indonesia has no DST. There are no dependencies, the result does not depend on `process.env.TZ`, and it is fast in aggregation loops. lims already does this with `OFFSET_WIB_MS`. Temporal is not unflagged in Node 24. |
| D2 | **The server clock decides.** `Attendance.date` and `checkInAt` come from server `now`. Client timestamps only feed anomaly flags. | The user controls the device clock. |
| D3 | **GPS accuracy handling:** reject when `accuracy` is missing or greater than 100 m. Accept when `distance ≤ radius + min(accuracy, 50)`. A check-in accepted only through the tolerance gets the flag `GEOFENCE_TOLERANCE`. | expo-location accuracy is a 68% confidence radius, and indoor GPS is often 20–60 m off. A strict `distance ≤ radius` rule rejects honest students at the edge of the fence. The 50 m cap limits how far the tolerance can be abused. |
| D4 | **Mocked location blocks the check-in (422 `MOCK_LOCATION`).** The attempt is saved as a rejection that the admin can see. When `mocked` is null (iOS or older OS), the check-in is accepted. The switch is the constant `BLOCK_MOCKED_LOCATION`. | An Android mock provider is always set up on purpose. With "flag only", the fake check-in becomes HADIR unless an admin fixes it by hand. |
| D5 | **GPS fix age is measured on the device clock:** `clientTime − locationTimestamp`. Reject above 180 s. Flag above 60 s. | Clock skew cancels out, and a stale "last known" fix taken at home gets rejected. |
| D6 | **Check-in window is `[open, close)` in whole local minutes.** A check-in is TERLAMBAT when `localMinute > start + tolerance`. `lateMinutes = localMinute − startMinute`, counted from the school bell. TERLAMBAT counts as present. | This rule is easy to explain: "07:16 or later is late". |
| D7 | **Definition of a school day:** the weekday is in `schoolDaysMask`, AND no Holiday covers the date (the school's own or national, where `schoolId` is NULL), AND the date falls inside **some** Term of that school. | Requiring a Term blocks mass ALPHA before the calendar is set up and during semester breaks. |
| D8 | **Duplicate check-in, keyed on (student, date):** <br>• an existing `CHECKIN` row returns **200** with that record and `replayed:true` (the second selfie is thrown away) <br>• an existing `ADMIN` or `AUTO_ALPHA` row returns **409** <br>• an existing `LEAVE` row is **converted** to CHECKIN | Mobile clients retry when the network is flaky. The natural key makes this idempotent without an extra column. |
| D9 | **Priority order: admin correction > presence > leave.** Approving a leave never overwrites CHECKIN or ADMIN rows. A check-in on a LEAVE day converts that row. An admin correction overwrites anything. | One simple rule gives the same result whichever event arrives first. |
| D10 | **Leave approval writes rows for every school day in the range, including future days.** | All reads then go through `Attendance` alone, and auto-ALPHA skips those rows naturally. |
| D11 | **Anomalies never block the check-in**, apart from the hard rejections in D3–D5. Students never see them. Each flag has a severity. `hasAnomaly` is true when any flag is MEDIUM or HIGH. | This avoids teaching cheaters what is detected. LOW flags are context for the admin, not a work queue. |
| D12 | **Anomalies between students** (shared device, identical coordinates, duplicate selfie) are checked at check-in time, best effort, and again **authoritatively in a day-close SQL sweep** run by the auto-ALPHA job. | Two concurrent transactions cannot see each other's rows. The sweep can be re-run safely. |
| D13 | **DEVIATION: "impossible travel" is measured against the student's rejected attempts in the last 60 minutes, not against the previous check-in.** | The previous check-in is at least a day earlier, so any distance is plausible and the rule as written would never fire. Rejected attempts are the only recent location samples we have. |
| D14 | **Rejected location attempts are stored** in a new `CheckInRejection` table, without the selfie. | The admin needs to see "tried from 3 km away" and to settle disputes. This is schema change SCR-1. |
| D15 | **Selfie handling:** <br>• type detected by magic bytes: JPEG, PNG or WebP <br>• size 10 KiB–5 MiB; shortest side at least 240 px <br>• re-encoded with sharp: `.rotate()`, resized to at most 640 px, JPEG quality 70 <br>• HEIC is rejected with 415 <br>• the check-in is processed only after the decision says ACCEPT | Re-encoding strips EXIF and GPS data and neutralises polyglot files. Each selfie is about 40 KB, so 1000 students need about 3.3 GB over 90 days. The prebuilt sharp cannot decode HEVC-based HEIC. |
| D16 | **Auto-ALPHA job:** <br>• server cron calls `POST /api/internal/jobs/auto-alpha` every 15 minutes <br>• auth: Bearer secret compared in constant time <br>• nginx denies `/api/internal` from outside <br>• one run per (school, local date), claimed through `JobRun` <br>• looks back and catches up missed days, up to 7 days | One cron line covers three timezones and a different day-end time per school. |
| D17 | **Auto-ALPHA repairs missing leave rows.** A student with an APPROVED leave covering the date but no row gets a LEAVE row, not ALPHA. | It self-heals after holiday edits or bugs. |
| D18 | **Percentages are counted over recorded student-days on closed school days.** "Today" uses the number of eligible ACTIVE students as the denominator. | Auto-ALPHA guarantees one row per eligible student per closed school day. This stays correct when students join, leave or change class mid-month, because `classId` is a snapshot. |
| D19 | **The backend never calls Google APIs.** The geofence is a server-side haversine calculation. The Maps JavaScript API, with a browser key restricted by referrer, only draws the points. | No cost, delay or secret on the check-in path. |
| D20 | **Check-in rate limit, in memory:** 10 attempts per 10 minutes per student → 429. | Same pattern as the lims login limiter. It assumes one PM2 instance; move it to Redis if the app is clustered. |
| D21 | **Tenant scope:** `resolveSchoolScope(session, ?schoolId)` on every admin route. An id from another tenant returns **404**, not 403. | 404 does not reveal that the record exists. |
| D22 | **Admin correction is an upsert keyed on (student, date).** A reason is required, AuditLog stores before/after, and the student gets a notification. Window: 45 days for SCHOOL_ADMIN; for SUPER_ADMIN, any past school day. | Tampering stays traceable, and parents can raise disputes. |
| D23 | **Leave rules:** <br>• a student may backdate up to 7 days, request up to 30 days ahead, and span up to 14 calendar days <br>• the range must contain at least one school day <br>• SAKIT covering 3 or more school days needs an attachment <br>• attachments must be images, no PDF <br>• a leave the admin enters for a student is approved at once and may be backdated up to 30 days | These match typical school practice, and allowing only images avoids building a PDF sanitiser. |
| D24 | **No offline check-in.** | Accepting the client's time would reopen time-based cheating. This goes to the client as question Q1. |
| D25 | **Writes to a student's attendance are serialised by `SELECT … FROM Student WHERE id=? FOR UPDATE`.** Lock order: Student → LeaveRequest → Attendance. A P2034 error, or a P2002 on the attendance (studentId, date) key, is retried up to 3 times. | This is a cheap lock per student. The retry covers the race with auto-ALPHA's bulk insert, which does not lock students. |

## 2. Endpoints

Roles: **ST** = STUDENT, **SA** = SCHOOL_ADMIN, **SU** = SUPER_ADMIN (on admin routes SU must pass `?schoolId=`, otherwise 400 `SCHOOL_ID_REQUIRED`), **CRON** = internal secret.

Every response uses the envelope `{success, data, error:{code,message,details}, meta}`. Local dates are `YYYY-MM-DD`, instants are ISO UTC, and a `…TimeLocal` field is `HH:mm`.

| METHOD | PATH | ROLE | Purpose | Key request | Key response |
|---|---|---|---|---|---|
| GET | /api/v1/student/attendance/today | ST | Data for the Absensi screen | – | `date, serverTime, timezone, ianaTimezone, schoolDay{isSchoolDay, reason?, holidayName?}, window{opensAt, lateAfter, closesAt, state: BEFORE_OPEN\|OPEN\|CLOSED}, geofence{latitude, longitude, radiusM, maxAccuracyM}, record\|null{id, status, source, checkInTimeLocal, lateMinutes}, pendingLeave\|null, canCheckIn, blockReason?` |
| POST | /api/v1/student/attendance/check-in | ST | Check-in (multipart; contract in §3.2) | `selfie, latitude, longitude, accuracy, mocked?, locationTimestamp, clientTime, deviceId` | 201/200 `{attendance{id, date, status, lateMinutes, checkInAt, checkInTimeLocal, distanceM, source}, replayed, message}`. No anomaly flags are returned. |
| GET | /api/v1/student/attendance?month=YYYY-MM | ST | History for one month (the month is the page) | `month` (last 24 months, not in the future) | `days[{date, status, source, checkInTimeLocal, lateMinutes, leaveRequestId}], nonSchoolDays[{date, reason, name?}], summary{recorded, present, late, izin, sakit, alpha, presentPct}`, `meta{prevMonth, nextMonth}` |
| GET | /api/v1/student/attendance/summary?termId= | ST | Counts for a semester (default: the term that covers today, else the latest one) | `termId?` | `term{id, label}, recorded, hadir, terlambat, izin, sakit, alpha, presentPct, closedThrough` |
| GET | /api/v1/student/leave-requests | ST | The student's own leave requests | `status?, page, limit` | `[{id, type, startDate, endDate, schoolDayCount, reason, status, attachmentFileId, reviewNote, reviewedAt, createdAt}]` + pagination |
| POST | /api/v1/student/leave-requests | ST | Submit IZIN/SAKIT (multipart) | `type, startDate, endDate, reason, attachment?` | 201 leave request |
| GET | /api/v1/student/leave-requests/:id | ST | Detail | – | leave request |
| POST | /api/v1/student/leave-requests/:id/cancel | ST | Cancel while PENDING | – | leave request (CANCELLED) |
| GET | /api/v1/admin/attendance/stats/today | SA, SU | "Kehadiran Hari Ini" card | – | `date, isSchoolDay, isClosed, eligible, present, late, izin, sakit, alpha, notYet, presentPct` |
| GET | /api/v1/admin/attendance/daily | SA, SU | "Data Absensi" tab (paged over students) | `date, classId?, status? (HADIR\|TERLAMBAT\|IZIN\|SAKIT\|ALPHA\|BELUM_ABSEN), anomaly? (any\|unreviewed), q? (name/NIS/NISN), page, limit≤100` | `[{student{id, nis, nisn, name, className}, attendance\|null{id, status, source, checkInTimeLocal, lateMinutes, distanceM, accuracyM, hasAnomaly, flags[], anomalyReviewed, leaveRequestId, note}}]` + pagination |
| GET | /api/v1/admin/attendance/map | SA, SU | "Peta Lokasi" tab | `date, classId?, status?, includeRejected?` | `school{latitude, longitude, radiusM}, counts{…, BELUM_ABSEN}, points[{attendanceId, studentId, name, nis, className, status, latitude, longitude, accuracyM, distanceM, checkInTimeLocal, hasAnomaly, flags[{code, severity}], reviewed}], rejected[{id, studentId, name, className, reason, latitude, longitude, accuracyM, distanceM, timeLocal}]`, `meta{truncated}` |
| GET | /api/v1/admin/attendance/recap | SA, SU | "Rekap Kelas" tab (one day) | `date` | `[{classId, className, eligible, hadir, terlambat, izin, sakit, alpha, notYet, presentPct}]` + totals |
| GET | /api/v1/admin/attendance/:id | SA, SU | Record detail and popup | – | record + `selfieUrl\|null (purged), flags[{code, severity, label}], deviceId, isMocked, fixAgeS?, rejectionsSameDay[], audit[≤20]` |
| PUT | /api/v1/admin/attendance/students/:studentId/days/:date | SA, SU | Manual correction (upsert) | `status, lateMinutes? (required for TERLAMBAT), reason (5–255)` | `{attendance, unchanged}` |
| GET | /api/v1/admin/attendance/anomalies | SA, SU | Anomaly review queue | `from, to (≤92 days), reviewed? (default false), classId?, page, limit` | rows as in `daily` + `flags` with severity |
| POST | /api/v1/admin/attendance/:id/anomaly-review | SA, SU | Mark an anomaly valid or invalid | `decision: VALID\|INVALID, note (5–255)` | record. INVALID also corrects the record to ALPHA (source ADMIN). |
| GET | /api/v1/admin/attendance/rejections | SA, SU | Rejected attempts | `date, studentId?, page, limit` | `[{id, student, reason, latitude, longitude, accuracyM, distanceM, isMocked, deviceId, createdAt}]` |
| GET | /api/v1/admin/attendance/analytics/classes | SA, SU | Bar chart per class for a month | `month` | `period{from, to, closedThrough, isPartial, unclosedDates[]}, classes[{classId, className, recorded, presentPct, latePct, izinPct, sakitPct, alphaPct, counts{…}}]` |
| GET | /api/v1/admin/attendance/analytics/summary | SA, SU | Donut with change vs last month | `month` | `{month, presentPct, counts, prevMonth, prevPresentPct, deltaPp, isPartial}` |
| GET | /api/v1/admin/attendance/analytics/classes/:classId/trend | SA, SU | Daily trend for one class | `from, to (≤92 days)` | `[{date, recorded, presentPct, counts}]` |
| GET | /api/v1/admin/attendance/analytics/students/:studentId | SA, SU | Monthly trend for one student | `months (1–12, default 6)` | `[{month, recorded, presentPct, counts}]` |
| GET | /api/v1/admin/students/:studentId/attendance | SA, SU | Month view of one student | `month` | same shape as the student month view |
| GET | /api/v1/admin/leave-requests | SA, SU | Leave queue | `status? (default PENDING), from?, to?, classId?, q?, page, limit` | `[{…leave, student{id, name, nis, className}}]` |
| GET | /api/v1/admin/leave-requests/:id | SA, SU | Detail | – | leave + `attachmentUrl` + school days in the range |
| POST | /api/v1/admin/leave-requests/:id/approve | SA, SU | Approve | `note?` | `{leaveRequest, materialized{created[], converted[], skipped[{date, reason}]}}` |
| POST | /api/v1/admin/leave-requests/:id/reject | SA, SU | Reject | `note (5–255, required)` | leave request |
| POST | /api/v1/admin/leave-requests | SA, SU | Enter a leave for a student, approved at once | `studentId, type, startDate, endDate, reason, attachment?` | as for approve |
| GET/PATCH | /api/v1/admin/school/attendance-settings | SA, SU | Geofence, times, days mask. The school domain owns the model; attendance supplies `validateAttendanceSettings`. | `latitude, longitude, geofenceRadiusM, timezone, checkInOpenMinute, startMinute, lateToleranceMinutes, checkInCloseMinute, dayEndMinute, schoolDaysMask` | settings. Each change is written to AuditLog. |
| POST | /api/internal/jobs/auto-alpha | CRON | Close school days | `{schoolId?, date?}` (`date` only together with `schoolId`) | `{processed[{schoolId, date, outcome: CLOSED\|SKIPPED_NON_SCHOOL_DAY\|ALREADY_DONE\|BUSY\|FAILED, alphaCreated, leaveCreated, anomaliesSwept}], hasMore, durationMs}` |
| POST | /api/internal/jobs/attendance-retention | CRON | Delete old selfies and rejections | – | `{selfiesPurged, rejectionsDeleted}` |
| GET | /api/v1/files/:id | ST, SA, SU | Owned by the platform/files domain; attendance supplies the rule | – | Bytes with `Cache-Control: private, no-store`. ATTENDANCE_SELFIE and LEAVE_ATTACHMENT: the owning student, an SA of the same school, or SU. Anyone else gets 404. A purged file gets 410. |

## 3. Business rules and algorithms

### 3.1 Constants (`src/lib/attendance/constants.ts`)

```ts
export const TZ_OFFSET_MINUTES = { WIB: 420, WITA: 480, WIT: 540 } as const;
export const TZ_IANA = { WIB: "Asia/Jakarta", WITA: "Asia/Makassar", WIT: "Asia/Jayapura" } as const;
export const EARTH_RADIUS_M = 6_371_008.8;
export const MIN_GEOFENCE_RADIUS_M = 50;           export const MAX_GEOFENCE_RADIUS_M = 1000;
export const MAX_ACCEPTED_ACCURACY_M = 100;        export const ACCURACY_TOLERANCE_CAP_M = 50;
export const LOW_ACCURACY_FLAG_M = 50;             export const SUSPICIOUS_ACCURACY_M = 1;
export const BLOCK_MOCKED_LOCATION = true;
export const FIX_AGE_FLAG_S = 60;                  export const FIX_AGE_REJECT_S = 180;
export const FIX_FUTURE_TOLERANCE_S = 10;          export const CLOCK_SKEW_FLAG_S = 300;
export const IMPOSSIBLE_TRAVEL_LOOKBACK_MIN = 60;  export const IMPOSSIBLE_TRAVEL_MIN_DISTANCE_M = 2000;
export const MAX_PLAUSIBLE_SPEED_KMH = 150;        export const MIN_TRAVEL_INTERVAL_S = 60;
export const IDENTICAL_COORD_DECIMALS = 6;         export const DEVICE_CHANGE_LOOKBACK_DAYS = 30;
export const MAX_CHECKIN_BODY_BYTES = 6 * 1024 * 1024;
export const MAX_SELFIE_BYTES = 5 * 1024 * 1024;   export const MIN_SELFIE_BYTES = 10 * 1024;
export const MIN_SELFIE_DIMENSION_PX = 240;        export const SELFIE_OUTPUT_MAX_PX = 640;
export const SELFIE_JPEG_QUALITY = 70;             export const MAX_IMAGE_INPUT_PIXELS = 25_000_000;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; export const ATTACHMENT_OUTPUT_MAX_PX = 1600;
export const ATTACHMENT_JPEG_QUALITY = 80;         export const IMAGE_PIPELINE_CONCURRENCY = 4;
export const CHECKIN_RATE_LIMIT = { max: 10, windowMs: 10 * 60_000 } as const;
export const MAX_LOGGED_REJECTIONS_PER_DAY = 20;
export const LEAVE_MAX_BACKDATE_DAYS = 7;          export const LEAVE_ADMIN_MAX_BACKDATE_DAYS = 30;
export const LEAVE_MAX_ADVANCE_DAYS = 30;          export const LEAVE_MAX_SPAN_DAYS = 14;
export const SICK_NOTE_REQUIRED_MIN_SCHOOL_DAYS = 3;
export const LEAVE_REASON_MIN = 10;                export const LEAVE_REASON_MAX = 500;
export const REVIEW_NOTE_MIN = 5;                  export const ADMIN_CORRECTION_MAX_AGE_DAYS = 45;
export const MAX_LATE_MINUTES = 720;
export const AUTO_ALPHA_LOOKBACK_DAYS = 7;         export const AUTO_ALPHA_BATCH_SIZE = 500;
export const JOB_STALE_AFTER_MS = 10 * 60_000;     export const JOB_TIME_BUDGET_MS = 90_000;
export const MAX_TX_RETRIES = 3;
export const MAP_POINTS_MAX = 5000;                export const ANALYTICS_MAX_RANGE_DAYS = 92;
export const HISTORY_MAX_MONTHS_BACK = 24;         export const STUDENT_TREND_MAX_MONTHS = 12;
export const SELFIE_RETENTION_DAYS = 90;           // needs client confirmation, see Q2
export const REJECTION_RETENTION_DAYS = 90;
```

### 3.2 Check-in contract (Expo)

`POST /api/v1/student/attendance/check-in`, `Authorization: Bearer <access>`, `multipart/form-data`. `Content-Length` is required: without it the server returns 411, and above `MAX_CHECKIN_BODY_BYTES` it returns 413 before parsing. The route sets `runtime = "nodejs"`. nginx needs `client_max_body_size 8m` for `/api/v1`. If a Next 16 `proxy.ts` matches these routes, its body-buffer limit also applies.

| Field | Type | Rule (zod v4) |
|---|---|---|
| `selfie` | File | Magic bytes must be JPEG `FFD8FF`, PNG `89504E47` or WebP `RIFF….WEBP`. The client's Content-Type is ignored. Size `MIN_SELFIE_BYTES`–`MAX_SELFIE_BYTES` (413 above the limit, 415 for a wrong type). |
| `latitude`, `longitude` | decimal string | `z.coerce.number()`, latitude −90..90, longitude −180..180. Stored rounded to 7 decimal places. |
| `accuracy` | number, m | 0–10000. Optional in the schema: if it is missing, the decision rejects it as `GPS_ACCURACY_TOO_LOW`. |
| `mocked` | `"true"\|"false"` | `z.stringbool().optional()`. If absent, stored as `null`. |
| `locationTimestamp` | int, ms epoch | `LocationObject.timestamp` |
| `clientTime` | int, ms epoch | `Date.now()` on the device when submitting |
| `deviceId` | string, 8–100 chars, `[A-Za-z0-9_-]` | Android: `Application.getAndroidId()`. iOS: `getIosIdForVendorAsync()`. It must equal `AuthSession.deviceId`, otherwise the check-in gets the flag DEVICE_SESSION_MISMATCH. |

Guidance for the Expo client:
1. Take the selfie first: front camera, `takePictureAsync({quality:0.7})`, then expo-image-manipulator resizes it to 1080 px JPEG.
2. Then call `getCurrentPositionAsync({accuracy: Accuracy.High})`. Never use `getLastKnownPositionAsync`.
3. Submit straight away.
4. Show `error.message` to the student exactly as the server sends it.
5. Student login must send `deviceId` and `platform`. This is a requirement on the auth domain.

Error codes:
- **400:** `VALIDATION_ERROR`
- **403:** `STUDENT_NOT_ACTIVE`
- **409:** `ATTENDANCE_ALREADY_RECORDED {status, source}`
- **413 / 415 / 411:** body or file size, file type, missing length
- **422:** `SELFIE_INVALID`, `NOT_SCHOOL_DAY {reason, holidayName?}`, `CHECKIN_NOT_OPEN {opensAt}`, `CHECKIN_CLOSED {closedAt}`, `INVALID_LOCATION`, `MOCK_LOCATION`, `LOCATION_STALE {fixAgeS}`, `GPS_ACCURACY_TOO_LOW {accuracyM, maxAccuracyM}`, `OUTSIDE_GEOFENCE {distanceM, radiusM}`
- **429:** `TOO_MANY_ATTEMPTS`

Example message: "Anda berada 412 m dari sekolah (batas 150 m)."

### 3.3 Check-in algorithm

1. **Gate:** the role is STUDENT, `mustChangePassword` is false (global gate), and the rate limit (key: userId) passes. This all happens before the body is parsed.
2. **Parse and validate.** Sniff the selfie's type without decoding it.
3. **Load context** (`loadCheckInContext`):
   - Student, User, School, currentClass. The check-in needs `Student.status=ACTIVE`, `User.isActive` and `School.isActive`, otherwise 403 `STUDENT_NOT_ACTIVE`.
   - `local = toSchoolLocal(now, tz)`.
   - Calendar: holidays of this school or national (`schoolId IS NULL`) that cover `local.date`, and terms that cover it.
   - The existing row for (student, `local.date`).
   - `AuthSession.deviceId`.
   - The previous CHECKIN row (deviceId, date).
   - CheckInRejection rows of this student from the last 60 minutes.
4. **`decideCheckIn` (pure).** It stops at the first rule that applies:
   1. The existing row: CHECKIN → REPLAY. ADMIN or AUTO_ALPHA → CONFLICT. LEAVE → mode `CONVERT_LEAVE`. No row → mode `CREATE`.
   2. `checkSchoolDay` false → `NOT_SCHOOL_DAY`. Reason priority: HOLIDAY (with its name) > OUTSIDE_TERM > DAY_OFF.
   3. `local.minute < openMinute` → `CHECKIN_NOT_OPEN`. `local.minute ≥ closeMinute` → `CHECKIN_CLOSED`.
   4. Location checks:
      - `lat === 0 && lng === 0` → `INVALID_LOCATION`
      - `mocked === true && BLOCK_MOCKED_LOCATION` → `MOCK_LOCATION`
      - `fixAgeS > FIX_AGE_REJECT_S` → `LOCATION_STALE`, where `fixAgeS = (clientTime − locationTimestamp)/1000`
      - `accuracy == null || accuracy > 100` → `GPS_ACCURACY_TOO_LOW`
      - `d = haversine(fix, school)`. If `d > radius + min(accuracy, 50)` → `OUTSIDE_GEOFENCE`
   5. ACCEPT:
      - If `localMinute > start + tolerance`: status TERLAMBAT, `lateMinutes = localMinute − start`.
      - Otherwise: status HADIR, `lateMinutes = null`.
      - `usedTolerance = d > radius`.
5. **REJECT:**
   - If the reason is INVALID_LOCATION, MOCK_LOCATION, LOCATION_STALE, GPS_ACCURACY_TOO_LOW or OUTSIDE_GEOFENCE, and the student has fewer than 20 logged rejections today, insert a `CheckInRejection` row.
   - Return 422. The selfie is never decoded or stored.
6. **REPLAY** returns 200 with the existing record. **CONFLICT** returns 409.
7. **ACCEPT:**
   - Re-encode the selfie (§3.5) and compute its `sha256`.
   - Gather evidence: the same sha256 among this school's ATTENDANCE_SELFIE files; distinct other students with the same `deviceId` today; other students with the same coordinates rounded to 6 decimals today.
   - Run `detectAnomalies` (pure).
8. **Write:**
   - `storage.putPrivate`: write to a temp file, then rename.
   - Transaction, with retries:
     - `SELECT id FROM Student WHERE id=? FOR UPDATE`.
     - Re-read the existing row. If it is CHECKIN, delete the new file and REPLAY. If it is ADMIN or AUTO_ALPHA, delete the file and return 409.
     - Insert the StoredFile. Then insert the Attendance row, or for a LEAVE row run `updateMany where {id, source:'LEAVE'}` to switch it to CHECKIN, keeping `leaveRequestId` and adding the note "Hadir pada hari izin".
     - Retro-flag other students' rows (§3.4).
   - If the transaction fails, remove the file.
9. **Respond 201.**

### 3.4 Anomaly flags

Flags are stored in `Attendance.anomalyFlags` as a sorted array of unique codes. `hasAnomaly` is true when any flag is MEDIUM or HIGH.

| Code | Severity | Trigger |
|---|---|---|
| SHARED_DEVICE | HIGH | The same `deviceId` has a check-in by a different student at the same school on the same date. **Both** records are flagged. |
| IDENTICAL_COORDINATES | HIGH | `round(lat,6)` and `round(lng,6)` equal another student's check-in at the same school on the same date. Both are flagged. |
| DUPLICATE_SELFIE | HIGH | The re-encoded sha256 equals an earlier ATTENDANCE_SELFIE in the same school, on any date. |
| IMPOSSIBLE_TRAVEL | HIGH | Compared with a rejected attempt by the same student in the last 60 minutes: `dist ≥ 2000 m` and `dist / max(Δt, 60 s) > 150 km/h`. |
| DEVICE_SESSION_MISMATCH | MEDIUM | The request's `deviceId` differs from `AuthSession.deviceId`. If the session has no deviceId, there is no flag. |
| TIME_INCONSISTENT | MEDIUM | `fixAgeS < −FIX_FUTURE_TOLERANCE_S`, meaning the GPS fix is dated after the submit time. |
| PERFECT_ACCURACY | MEDIUM | `accuracy ≤ 1` m (mock apps report 0 or 1). |
| DEVICE_CHANGED | LOW | The previous CHECKIN within the last 30 days used a different deviceId. |
| STALE_FIX | LOW | `60 < fixAgeS ≤ 180` |
| CLOCK_SKEW | LOW | `|clientTime − now| > 300 s` |
| LOW_ACCURACY | LOW | `accuracy > 50` |
| GEOFENCE_TOLERANCE | LOW | `distance > radius`; accepted only through the tolerance. |

- **Retro-flagging at check-in**, inside the same transaction, one statement per code:

  ```sql
  UPDATE Attendance SET hasAnomaly = 1, anomalyFlags = JSON_ARRAY_APPEND(COALESCE(anomalyFlags, JSON_ARRAY()), '$', 'SHARED_DEVICE')
  WHERE schoolId=? AND date=? AND deviceId=? AND studentId<>? AND (anomalyFlags IS NULL OR NOT JSON_CONTAINS(anomalyFlags,'"SHARED_DEVICE"'))
  ```

- **Day-close sweep.** This is authoritative and safe to re-run. It runs inside `closeSchoolDay` after the ALPHA insert:
  - `UPDATE … JOIN (SELECT deviceId … WHERE schoolId=? AND date=? AND checkInAt IS NOT NULL GROUP BY deviceId HAVING COUNT(DISTINCT studentId)>1)`, and the same with `GROUP BY ROUND(latitude,6), ROUND(longitude,6)`.
  - MariaDB 10.3+ allows the same table as both source and target of an UPDATE.
- **Anomaly review** sets `anomalyReviewedAt/ById/Note` and never clears the flags.

### 3.5 Selfie and attachment sanitising (`src/lib/files/image-sanitize.ts`)

- Pipeline: `sharp(buf, {limitInputPixels: MAX_IMAGE_INPUT_PIXELS, failOn: "error"}).rotate().resize({width: MAX, height: MAX, fit: "inside", withoutEnlargement: true}).jpeg({quality, mozjpeg: true})`. No `withMetadata`, so EXIF and GPS data are dropped.
- If the decoded shortest side is under 240 px, return 422 `SELFIE_INVALID`. Any decode error also returns `SELFIE_INVALID`.
- Set `sharp.cache(false)`, `sharp.concurrency(1)`, and a module semaphore of `IMAGE_PIPELINE_CONCURRENCY`.
- Storage key: `private/attendance/<schoolId>/<yyyy>/<mm>/<cuid>.jpg`. StoredFile row: `kind=ATTENDANCE_SELFIE`, `schoolId` set, `uploadedById` = the student's user.
- Leave attachments go through the same pipeline at 1600 px and quality 80, with `kind=LEAVE_ATTACHMENT`.
- Retention job (daily):
  - Selfie files older than `SELFIE_RETENTION_DAYS`: delete the bytes and set `StoredFile.purgedAt`. The Attendance row stays.
  - `CheckInRejection` rows older than 90 days: deleted.

### 3.6 School calendar and time

- **`toSchoolLocal(instant, tz)`:**
  - `ms = instant + offset·60000`
  - `date = ISO(ms).slice(0,10)`
  - `minute = floor((ms mod 86400000) / 60000)`
  - `weekdayIdx = (getUTCDay(ms) + 6) % 7`, so Monday is 0 and the mask bit is `1 << weekdayIdx`.
- **Database dates:** `toDbDate(d) = new Date(d + "T00:00:00.000Z")`, and `fromDbDate` reads the UTC part back.
- **`checkSchoolDay(date, ctx)`:** the weekday bit is in the mask, no holiday covers the date (inclusive), and some term covers it.
- **`listSchoolDays(from, to, ctx)`:** every school day in the range.
- **Settings validation** (`validateAttendanceSettings`, also enforced by CHECK constraints):
  - `open < start ≤ close ≤ dayEnd < 1440`
  - `start + tolerance < close`
  - tolerance 0–120
  - radius 50–1000
  - mask 1–127

### 3.7 Auto-ALPHA job

1. **Trigger.** A crontab line runs every 15 minutes: `curl -fsS -m 120 -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:$PORT/api/internal/jobs/auto-alpha`.
   - The route compares `sha256(header)` with `sha256(secret)` using `timingSafeEqual`, and returns 401 on mismatch.
   - nginx has `location /api/internal { deny all; }`.
2. **For each active school**, loop until `JOB_TIME_BUDGET_MS` runs out, then return `hasMore`. Candidate dates (`candidateCloseDates`):
   - `D = local.date − k` for k = 0..7.
   - Today (k=0) only once `local.minute ≥ dayEndMinute`.
   - D must be on or after the local date of `School.createdAt`.
   - D must not already have a SUCCEEDED JobRun (one batched lookup).
3. **Claim.** Insert `JobRun(job="auto-alpha", scopeKey=schoolId, runKey=D, RUNNING)`.
   - On P2002, if the existing run is SUCCEEDED, stop with `ALREADY_DONE`.
   - If it is RUNNING and less than 10 minutes old, stop with `BUSY`.
   - If it is RUNNING and stale, or FAILED, take it over with `updateMany where {id, status, startedAt ≤ cutoff}`. A count of 0 means `BUSY`.
4. **Non-school day** → mark SUCCEEDED with `{skipped:"NON_SCHOOL_DAY"}`.
5. **Eligible students:** `status=ACTIVE`, and the local date of `activatedAt` ≤ D, and no Attendance row for D (anti-join).
   - If an APPROVED LeaveRequest covers D, draft `{status: type, source: LEAVE, leaveRequestId}`.
   - Otherwise draft `{status: ALPHA, source: AUTO_ALPHA}`. `classId` is the snapshot of `currentClassId`.
   - A PENDING leave does not protect the student: they get ALPHA, and approving the leave later converts it.
6. **Insert** with `createMany({skipDuplicates: true})` in chunks of 500. The unique key (studentId, date) makes this safe to re-run. Then run the §3.4 sweep and mark the JobRun SUCCEEDED with `{alphaCreated, leaveCreated, anomaliesSwept}`.
7. **Failure:** mark the JobRun FAILED with the error text. The next cron run retries it.
8. **Manual re-run** (SU/ops): `{schoolId, date}`. The date must be closed and within term.

### 3.8 Leave requests

1. **Create (student)**, inside a transaction holding the Student lock:
   - `today − 7 ≤ start ≤ end ≤ today + 30`, and `end − start ≤ 13` (a span of 14 days at most).
   - `schoolDayCount ≥ 1`, otherwise 422 `NO_SCHOOL_DAYS_IN_RANGE`.
   - No PENDING or APPROVED leave of this student overlaps the range, otherwise 409 `LEAVE_OVERLAP`. Adjacent ranges do not overlap.
   - If `type=SAKIT` and `schoolDayCount ≥ 3` and there is no attachment, return 422 `ATTACHMENT_REQUIRED`.
   - Days that already have a CHECKIN row are allowed in the range.
   - Notify every active SA of the school with `LEAVE_SUBMITTED` (inbox only).
2. **Cancel (student):** `updateMany where {id, studentId, status: PENDING}` sets CANCELLED. A count of 0 means 404 if the request is not the student's, otherwise 409.
3. **Approve (admin):**
   - Read the leave's studentId within the tenant scope (404 if not found).
   - Lock the Student row, then lock the LeaveRequest with `FOR UPDATE`. It must still be PENDING, otherwise 409 `LEAVE_ALREADY_REVIEWED`. The student must be ACTIVE, otherwise 409.
   - `days = listSchoolDays(range)` (past, today and future). Read the existing rows and run `planLeaveMaterialization`:

     | Existing row | Action | Skip reason |
     |---|---|---|
     | none | create LEAVE | – |
     | AUTO_ALPHA | convert with `updateMany where source='AUTO_ALPHA'` | – |
     | CHECKIN | keep | CHECKED_IN |
     | ADMIN | keep | ADMIN_OVERRIDE |
     | LEAVE | keep | ALREADY_LEAVE |

   - Set APPROVED, `reviewedBy`, `reviewedAt`. Write the Notification `LEAVE_APPROVED` (push to the student) and the AuditLog entry `leave.approve`.
   - A P2002 caused by a concurrent auto-ALPHA insert triggers a retry, which then converts that row.
4. **Reject:** the note is required. Lock the Student, compare-and-set PENDING → REJECTED, notify `LEAVE_REJECTED`. Attendance is not touched.
5. **Admin enters a leave for a student:** same validation, but backdating up to 30 days is allowed. It is created APPROVED and materialised in one transaction.
6. **Calendar changes.** The school domain calls `onCalendarChanged(schoolId|null, from, to, kind)`.
   - **Holiday added:** delete rows with `source IN (AUTO_ALPHA, LEAVE)` in the range and write an audit entry. CHECKIN and ADMIN rows are kept.
   - **Holiday removed or shortened:** delete the auto-alpha JobRun rows for those dates within the lookback window, so the next cron run closes them again and restores LEAVE rows. Past days before the lookback window need a manual SU re-run.
   - A national holiday loops over every school.
   - Changes to `schoolDaysMask` or Term do not change existing rows (documented).

### 3.9 Admin correction (`PUT …/students/:studentId/days/:date`)

- **Rules:**
  - `date ≤ today`, otherwise `FUTURE_DATE`.
  - The date must be a school day, otherwise `NOT_SCHOOL_DAY`.
  - For SA, `today − date ≤ 45`, otherwise `CORRECTION_WINDOW_EXPIRED`.
  - `status=TERLAMBAT` requires `lateMinutes` of 1–720. Any other status must not send `lateMinutes`.
  - The student must belong to the scoped school (404 otherwise). A non-ACTIVE student is allowed for past dates.
- **Transaction:** lock the Student row, read the row for (student, date), then run `buildCorrectionPatch`:
  - no row → create with `source=ADMIN`, `classId` = the current class
  - existing row → set `status`, `lateMinutes`, `source=ADMIN`, `note=reason`
  - the check-in evidence (coordinates, selfie, device, flags) is **kept**
  - same status and same `lateMinutes` → `unchanged:true`, with no audit and no notification
- **Also written:** AuditLog `attendance.correct` with `before/after {status, source, lateMinutes, note}`, and Notification `ATTENDANCE_CORRECTED` (category STUDENT_AFFAIRS, push).
- **Anomaly review INVALID** = this correction with status ALPHA and the review note as the reason, plus the reviewed fields set.

### 3.10 Percentages (`attendance-stats.ts`)

- `present = HADIR + TERLAMBAT`. `late` is TERLAMBAT alone, a subset of present.
- `closedThrough(now, school)` = today if `local.minute ≥ dayEndMinute`, otherwise yesterday. Periods are cut at `min(periodEnd, closedThrough)`.
- **Monthly percentage per class or school:**
  - `recorded` = the number of Attendance rows with `date ∈ [from, cut]` (and, for a class, `classId` = the snapshot class).
  - `xPct = count_x / recorded × 100`.
  - The school average is pooled (weighted by student-days), not the mean of the class percentages.
  - `meta.unclosedDates` = school days in the period with no SUCCEEDED JobRun, so the UI can warn that data is incomplete.
- **Change vs last month:** `deltaPp = round1(currPct − prevPct)` in percentage points. `isPartial` is true when the current month is still running. The previous month is always complete.
- **Today card:**
  - `eligible` = ACTIVE students whose `activatedAt` local date ≤ today.
  - Counts come from today's rows of those students.
  - `notYet = max(0, eligible − rowsToday)`.
  - `presentPct = present / eligible`.
  - On a non-school day, `presentPct` is null.
- **Rounding:** `round1(x) = Math.round(x·10)/10` on the computed percentage. Counts are always returned too. `pct(n, 0) = null`.
- **Queries:** `groupBy(['classId','status'])` over `[schoolId, date, classId, status]`, which the index fully covers. The student trend fetches at most about 260 rows and aggregates them in a pure function.

## 4. Service modules and pure modules

**Pure modules** (no Prisma; each has a colocated `*.test.ts`):

- `src/lib/time/school-time.ts`
  - `toSchoolLocal(instant: Date, tz: SchoolTz): LocalClock` returns `{date: LocalDate; minute: number; weekdayIdx: number}`
  - `parseLocalDate(s): LocalDate|null`, `addDays(d, n)`, `diffDays(a, b)`, `eachDate(from, to): LocalDate[]`
  - `toDbDate(d): Date`, `fromDbDate(d: Date): LocalDate`
  - `localMinuteToInstant(d, minute, tz): Date`, `formatMinute(m): string`, `monthRange(ym): {from, to}`
- `src/lib/attendance/school-calendar.ts`
  - `checkSchoolDay(date, ctx: CalendarContext): DayCheck`
  - `listSchoolDays(from, to, ctx): LocalDate[]`
  - `validateAttendanceSettings(s): Result<SettingsError[]>`
- `src/lib/attendance/geo.ts`
  - `haversineMeters(a: LatLng, b: LatLng): number`, `isNullIsland(p): boolean`, `roundCoord(v, dp): number`, `speedKmh(m, s): number`
- `src/lib/attendance/check-in-rules.ts`
  - `classifyExisting(e): 'CREATE'|'CONVERT_LEAVE'|'REPLAY'|'CONFLICT'`
  - `checkWindow(minute, policy): WindowResult`
  - `computeLateness(minute, policy): {status, lateMinutes}`
  - `evaluateLocation(fix, policy): LocationResult`
  - `decideCheckIn(input: CheckInDecisionInput): CheckInDecision`
- `src/lib/attendance/anomaly-rules.ts`
  - `ANOMALY_SEVERITY`
  - `detectAnomalies(input: AnomalyInput): readonly AnomalyCode[]`
  - `isReportable(flags): boolean`, `parseFlags(json: unknown): AnomalyCode[]`
  - `anomalyLabel(code): string` (Indonesian)
- `src/lib/attendance/leave-rules.ts`
  - `validateLeaveRange({start, end, today, actor}): Result`
  - `rangesOverlap(a, b): boolean`, `requiresAttachment(type, schoolDays): boolean`
  - `planLeaveMaterialization(days, existing, type): LeavePlan`
- `src/lib/attendance/auto-alpha-rules.ts`
  - `candidateCloseDates(now, school, doneKeys: ReadonlySet<string>): LocalDate[]`
  - `isEligibleOn(student, date, tz): boolean`
  - `planDayClose(date, eligible, approvedLeaves): AttendanceDraft[]`
- `src/lib/attendance/correction-rules.ts`
  - `validateCorrection(input, ctx): Result`
  - `buildCorrectionPatch(existing|null, input): CorrectionPatch` (`kind` create/update/noop, `before`, `after`)
- `src/lib/attendance/attendance-stats.ts`
  - `pct(n, d)`, `round1(x)`, `summarize(counts): RateSummary`, `deltaPp(a, b)`
  - `closedThrough(now, tz, dayEnd): LocalDate`
  - `todayCard(eligible, counts)`, `aggregateByMonth(rows)`
- `src/lib/files/image-sniff.ts`: `sniffImage(buf: Uint8Array): 'jpeg'|'png'|'webp'|'heic'|'unknown'`

**Other modules:**

- `src/lib/attendance/constants.ts`
- `src/lib/attendance/schemas.ts` (zod v4): `checkInFieldsSchema`, `leaveCreateSchema`, `leaveReviewSchema`, `correctionSchema`, `anomalyReviewSchema`, `dailyQuerySchema`, `mapQuerySchema`, `monthParam`, `rangeQuerySchema`, `jobBodySchema`
- `src/lib/attendance/errors.ts`: `class AttendanceError extends DomainError {code; status; details}`

**Impure modules:**

- `src/lib/files/image-sanitize.ts`: `reencodeImage(buf, {maxPx, quality, minPx}): Promise<{bytes, width, height, sha256}>`
- `src/lib/attendance/check-in-context.ts`
  - `loadCheckInContext(userId, now): Promise<CheckInContext>`
  - `loadAnomalyEvidence(ctx, fix, sha256, now): Promise<AnomalyEvidence>`
- `src/lib/attendance/check-in-service.ts`: `checkIn(req: CheckInRequest, session: Session, deps: {clock: () => Date; storage: FileStorage}): Promise<CheckInResult>`
- `src/lib/attendance/rejection-log.ts`: `logRejection(ctx, code, fix, now): Promise<void>` (capped)
- `src/lib/attendance/leave-service.ts`: `createLeave`, `cancelLeave`, `approveLeave`, `rejectLeave`, `createLeaveOnBehalf`. All take `(input, session, deps)`.
- `src/lib/attendance/correction-service.ts`
  - `correctAttendance(key: {studentId; date}, input, session, deps)`
  - `reviewAnomaly(id, input, session, deps)`
- `src/lib/attendance/auto-alpha-job.ts`
  - `runAutoAlphaJob({now, schoolId?, date?, budgetMs}): Promise<JobReport>`
  - `closeSchoolDay(school, date, now): Promise<CloseOutcome>`
  - `sweepCrossStudentAnomalies(schoolId, date): Promise<number>`
- `src/lib/attendance/calendar-sync.ts`: `onCalendarChanged(scope, from, to, kind)`
- `src/lib/attendance/retention-job.ts`: `runAttendanceRetention(now)`
- `src/lib/attendance/tx.ts`: `withAttendanceTx(fn)`. It retries P2034 and P2002 on `Attendance_studentId_date_key`, and sets `{timeout: 20000, maxWait: 10000}`.
- `src/lib/attendance/student-queries.ts`: `getToday`, `getStudentMonth(studentId, month, scope)`, `getStudentSummary`, `listOwnLeaves`
- `src/lib/attendance/monitoring-queries.ts`: `todayStats`, `listDaily`, `mapPoints`, `classRecap`, `getRecordDetail`, `listAnomalies`, `listRejections`, `listLeaves`
- `src/lib/attendance/analytics-queries.ts`: `classMonthly`, `schoolMonthlySummary`, `classTrend`, `studentTrend`

**Shared modules** (owned by other domains; this domain needs them):

- `src/lib/jobs/job-run.ts`: `claimJobRun(job, scopeKey, runKey, now)` returns `'CLAIMED'|'DONE'|'BUSY'`; `finishJobRun(id, result|error)`
- `src/lib/auth/school-scope.ts`: `resolveSchoolScope(session, requested?): string`
- `src/lib/internal/cron-auth.ts`: `verifyCronSecret(req): boolean`
- `src/lib/rate-limit.ts` (injectable clock)

**Routes:** under `src/app/api/v1/student/attendance/**`, `…/student/leave-requests/**`, `…/admin/attendance/**`, `…/admin/leave-requests/**` and `src/app/api/internal/jobs/{auto-alpha,attendance-retention}/route.ts`. Each is thin glue: gate → zod → service → error map.

## 5. Tests

**Unit tests** (`node --import tsx --test`, clocks injected):

- **school-time:**
  - WIB `2026-09-20T23:30Z` → `2026-09-21` 06:30, Monday
  - WIT `2026-09-20T15:00Z` → `2026-09-21` 00:00
  - WITA `2026-09-21T15:59Z` → 23:59, same date
  - offsets equal `Intl` for the three IANA zones on 12 sample instants
  - result is the same when `process.env.TZ` is `Asia/Jayapura` or `America/New_York`
  - `toDbDate` / `fromDbDate` roundtrip
  - `2026-02-30` → null
  - `eachDate` across a year boundary; `monthRange` for February 2028 (leap year)
- **school-calendar:**
  - mask 31: Saturday is DAY_OFF; mask 63: Saturday is a school day, Sunday is off
  - national holiday endpoints are inclusive
  - gap between terms → OUTSIDE_TERM
  - HOLIDAY takes priority over DAY_OFF
  - `listSchoolDays` skips holidays and returns `[]` when every day is a holiday
  - settings validation: `start + tol ≥ close` is rejected; radius 49 and 1001 are rejected
- **geo:** zero distance; 0.001° of latitude ≈ 111.2 m (±0.5); symmetry; null island; rounding to 6 decimal places
- **check-in-rules:**
  - window: minute 359 is NOT_OPEN, 360 is OK, 599 is OK, 600 is CLOSED
  - lateness (start 420, tolerance 15): 435 is HADIR; 436 is TERLAMBAT with 16; with tolerance 0, 420 is HADIR and 421 is TERLAMBAT with 1
  - geofence at radius 150:
    - distance 150 at accuracy 5 → OK, no tolerance used
    - 170 at accuracy 30 → OK, `usedTolerance`
    - 170 at accuracy 10 → rejected
    - 210 at accuracy 80 → rejected (the cap is 50)
    - accuracy 100 → evaluated; 100.1 → LOW_ACCURACY even at distance 0; null → rejected
  - `mocked` true beats a good geofence result; `mocked` null proceeds
  - fixAge 180 is OK; 181 is LOCATION_STALE
  - (0,0) → INVALID_LOCATION
  - order of checks: existing CHECKIN → REPLAY even after close; ADMIN/AUTO_ALPHA → CONFLICT; LEAVE → continues checking and gives CONVERT; NOT_SCHOOL_DAY is checked before the window
- **anomaly-rules:**
  - every code at its threshold ±ε
  - PERFECT_ACCURACY: 0 and 1 flag, 1.01 does not
  - IMPOSSIBLE_TRAVEL: 5 km in 60 s flags; 1.5 km does not; 61 minutes old does not; Δt of 10 s is clamped to 60 s
  - TIME_INCONSISTENT: −11 s flags, −10 s does not
  - CLOCK_SKEW: 301 s flags
  - no DEVICE_SESSION_MISMATCH when the session deviceId is null
  - only LOW flags → `isReportable` false
  - `parseFlags` tolerates null, garbage and duplicates
- **leave-rules:**
  - backdate 7 OK, 8 rejected; admin 30 OK, 31 rejected
  - advance 30 OK, 31 rejected
  - span 14 OK, 15 rejected; `end < start` rejected
  - 0 school days → rejected
  - SAKIT: 3 school days without attachment rejected, 2 OK; IZIN 5 days without attachment OK
  - overlap: adjacent ranges do not overlap; containment and same day do
  - plan mapping for each existing source, including future days
- **auto-alpha-rules:**
  - WIB school with dayEnd 900: `07:59Z` → not a candidate; `08:00Z` → candidate
  - the same instant for a WIT school gives a different result
  - lookback stops at the school's createdAt and excludes done keys
  - `activatedAt` `2026-09-20T15:30Z` in WIT counts as eligible on 09-21
  - approved leave → LEAVE draft; otherwise ALPHA with the class snapshot; no eligible students → `[]`
- **correction-rules:**
  - future date rejected; 46 days old rejected for SA, allowed for SU
  - non-school day rejected
  - TERLAMBAT without `lateMinutes` rejected; HADIR with `lateMinutes` rejected; reason of 4 characters rejected
  - same values → noop
  - evidence fields preserved; `lateMinutes` cleared when not TERLAMBAT
- **attendance-stats:**
  - `pct(0,0)` is null; 2/3 → 66.7
  - present includes TERLAMBAT
  - `deltaPp(91.2, 93.5)` → −2.3; null input → null
  - `closedThrough` before and after dayEnd
  - `notYet` never negative
  - `aggregateByMonth` across a month boundary
- **image-sniff and image-sanitize:**
  - JPEG, PNG, WebP, HEIC, GIF and text renamed to `.jpg` are each detected correctly
  - output has no EXIF: an input with GPS EXIF comes out with `metadata().exif` undefined
  - orientation is applied
  - 4000 px is downscaled to 640; 200×200 is rejected
  - decompression bomb exceeding `limitInputPixels` is rejected
  - a JPEG with a ZIP or HTML payload appended → the trailing bytes are gone
  - the same input gives the same sha256

**Integration tests** (`src/**/*.int.test.ts`, MariaDB 10.11 service container in CI):

- `@db.Date` and DATETIME roundtrip through the adapter with `TZ=UTC`.
- **Check-in:**
  - happy path: Attendance and StoredFile rows exist, the file is on disk, no EXIF
  - two concurrent submits (`Promise.all`) → exactly one row and one file, the orphan file is removed, the responses are 201 and 200-replay
  - replay after close; LEAVE row converted and `leaveRequestId` kept; ADMIN row → 409 and no file written
  - outside geofence → 422, a CheckInRejection row, no file; rejection log capped at 20 per day
  - SHARED_DEVICE flags both rows; IDENTICAL_COORDINATES; DUPLICATE_SELFIE across dates
  - student in DRAFT, or school inactive → 403
  - WIT check-in at `23:30Z` is stored with the next local date
  - rate limit gives 429 on the 11th attempt
- **Auto-ALPHA:**
  - first run creates ALPHA rows; second run creates 0 and there is one SUCCEEDED JobRun
  - two parallel runs → one CLOSED and one BUSY/DONE
  - weekend and holiday → SKIPPED
  - approved leave without a row → LEAVE row; pending leave → ALPHA
  - student activated after D → no row; inactive student → no row
  - missed day caught up; stale RUNNING taken over after 10 minutes (injected clock); FAILED retried
  - the sweep flags a shared device that the race missed
- **Leave:**
  - two concurrent creates → 201 and 409
  - approve converts AUTO_ALPHA, keeps CHECKIN and ADMIN, creates future days
  - two concurrent approves → one succeeds, the other gets 409
  - approve racing auto-ALPHA ends with IZIN, not ALPHA
  - reject requires a note; cancel works only on the student's own PENDING request
  - SA of another school → 404
  - notifications written: LEAVE_SUBMITTED to every SA, LEAVE_APPROVED to the student
- **Calendar hook:**
  - adding a retroactive holiday deletes AUTO_ALPHA and LEAVE rows but keeps CHECKIN
  - removing a holiday deletes the JobRun, and the next run closes the day again
- **Correction:**
  - creates a row when there is none; update writes AuditLog before/after; TERLAMBAT → HADIR clears `lateMinutes`
  - ATTENDANCE_CORRECTED notification written
  - SA of another school → 404; SU without schoolId → 400
  - anomaly review VALID sets reviewed; INVALID gives ALPHA with source ADMIN and an audit entry
- **Queries:**
  - analytics on a fixed seeded month give exact percentages
  - a student who changed class mid-month is counted in the old class for the old days
  - today is excluded before dayEnd; `unclosedDates` is reported
  - today card; BELUM_ABSEN filter with paging
  - map returns only rows with coordinates and sets `truncated` above `MAP_POINTS_MAX`
- **Files and internal jobs:**
  - selfie readable by its student and by an SA of the same school; 404 for another school's SA and for another student; 410 after purge
  - missing or wrong cron secret → 401
  - retention job purges the bytes and keeps the Attendance row

**E2E** (Playwright, API level): student logs in → today → check-in with a fixture selfie → history shows the right status → submits leave → admin approves → student history shows IZIN → admin map shows the point.

## 6. SCHEMA CHANGE REQUESTS

**SCR-1: new enum and model `CheckInRejection`** (supports D14 and D13).

```prisma
enum CheckInRejectReason {
  OUTSIDE_GEOFENCE
  LOW_ACCURACY
  MOCK_LOCATION
  STALE_LOCATION
  INVALID_LOCATION
}

/// Percobaan check-in yang DITOLAK karena lokasi (tanpa selfie). Append-only; dihapus > 90 hari.
model CheckInRejection {
  id        String              @id @default(cuid())
  schoolId  String
  studentId String
  /// Tanggal lokal sekolah.
  date      DateTime            @db.Date
  reason    CheckInRejectReason
  latitude  Decimal?            @db.Decimal(10, 7)
  longitude Decimal?            @db.Decimal(10, 7)
  accuracyM Int?
  distanceM Int?
  isMocked  Boolean?
  deviceId  String?             @db.VarChar(100)

  school  School  @relation(fields: [schoolId], references: [id], onDelete: Restrict)
  student Student @relation(fields: [studentId], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now())

  @@index([schoolId, date])
  @@index([studentId, createdAt])
}
```

Back-relations: add `checkInRejections CheckInRejection[]` to both `School` and `Student`.

**SCR-2: `Attendance` anomaly review.** Without these fields the review queue can never shrink.

```prisma
  anomalyReviewedAt   DateTime?
  anomalyReviewedById String?
  anomalyReviewNote   String?   @db.VarChar(255)
  anomalyReviewedBy   User?     @relation("AttendanceAnomalyReviewer", fields: [anomalyReviewedById], references: [id], onDelete: Restrict)
```

- Index: replace `@@index([schoolId, hasAnomaly, date])` with `@@index([schoolId, hasAnomaly, anomalyReviewedAt, date])`.
- `User` gets `attendanceAnomalyReviews Attendance[] @relation("AttendanceAnomalyReviewer")`.
- Doc comment on `lateMinutes`: "menit setelah startMinute (bel masuk)".
- Doc comment on `anomalyFlags`: the fixed code list from §3.4.

**SCR-3: `LeaveRequest` index.** Add `@@index([schoolId, status, startDate])` for the auto-ALPHA and monitoring lookup "approved leave that covers date D".

**SCR-4: `StoredFile` retention.** Add `purgedAt DateTime?` and `@@index([kind, createdAt])`. The selfie bytes are deleted but the row stays, so the Attendance foreign key survives.

**SCR-5: `NotificationType`.** Append `ATTENDANCE_CORRECTED` at the **end** of the enum.

**SCR-6: raw SQL CHECK constraints** in the init migration, each verified in CI:

- **Attendance:**
  - `source<>'CHECKIN' OR (checkInAt IS NOT NULL AND latitude IS NOT NULL AND longitude IS NOT NULL AND selfieFileId IS NOT NULL)`
  - `source<>'AUTO_ALPHA' OR status='ALPHA'`
  - `source<>'LEAVE' OR (status IN ('IZIN','SAKIT') AND leaveRequestId IS NOT NULL)`
  - `(status='TERLAMBAT') = (lateMinutes IS NOT NULL AND lateMinutes BETWEEN 1 AND 720)`
- **School:**
  - `geofenceRadiusM BETWEEN 50 AND 1000`
  - `lateToleranceMinutes BETWEEN 0 AND 120`
  - `startMinute + lateToleranceMinutes < checkInCloseMinute`
  - `schoolDaysMask BETWEEN 1 AND 127`
- **LeaveRequest:** `DATEDIFF(endDate, startDate) BETWEEN 0 AND 30`

**Requirement on the auth domain (no schema change):** STUDENT sessions on ANDROID or IOS must set `AuthSession.deviceId`.

## 7. Risks and questions for the client

**Questions only the client can answer:**

1. **Q1. Connectivity at schools.** Are there schools with no mobile data or Wi-Fi on site? This design requires a live connection at check-in. Offline check-in would need a signed, queued design and weakens the time rules.
2. **Q2. Selfie retention (UU PDP, minors).** The default is to delete selfie files after **90 days** and keep the attendance row. Capacity at 640 px is about 3.3 GB per 1000 students per 90 days, against 54 GB free on the VPS. Please confirm the period, and whether parental consent is already covered.
3. **Q3. Mocked GPS.** I chose to **block** it (D4). The alternative is accept-and-flag. Please confirm.
4. **Q4. Policy defaults to confirm:**
   - leave may be backdated 7 days, requested 30 days ahead, and span 14 days
   - SAKIT covering 3 or more school days needs a doctor's note, and attachments are photos only (no PDF)
   - admin corrections are allowed up to 45 days back
   - students see why they were rejected (for example, their distance from school)
5. **Q5. Several campuses.** Does any school need more than one geofence? The schema designer raised this too. If yes, it needs a `SchoolGeofence` table and `decideCheckIn` checks the nearest one.

**Risks, no answer needed:**

- A rooted phone with a hidden mock provider, or an iOS spoofer, cannot be detected without Play Integrity or App Attest. Suggested later.
- Siblings sharing one phone will raise SHARED_DEVICE flags that admins then mark VALID.
- The in-memory rate limiter assumes one PM2 instance.
- Auto-ALPHA can close a day up to 15 minutes after its end time.
- Changing `schoolDaysMask` or a Term does not rewrite existing rows.
