# N5 — Pengingat absen (attendance reminder push)

## 0. Revisi setelah kritik (2026-10-03) — berlaku di atas draf di bawah

Sumber: `N5-attendance-reminders.critique.md` + `00-integration.md` §2 (keputusan 1, 6, 7, 9). Semua temuan diterima:

| # Kritik | Keputusan (sudah diimplementasikan) |
|---|---|
| 1 | Kasus `chk_school_reminder_lead` di `SCHOOL_CASES` (4 & 121 ditolak, 120 lolos). |
| 2 | **Bawaan tetap MENYALA (15 menit)** sesuai default §10.1, tetapi job **tidak mengirim untuk sekolah yang jadwalnya masih bawaan** (`isDefaultSchedule`, satu definisi di `reminder-rules.ts`, dipakai juga daftar persiapan Beranda). Kartu & langkah persiapan "Pengingat absen" menjelaskannya. **Keputusan akhir §10.1 tetap milik pemilik sebelum merge ke master** (ubah default = satu baris migrasi/skema). |
| 3 | `pushExpiresAt` ikut ke transport: TTL Web Push ≤ detik menuju batas (tanpa lantai 60 dtk), Expo `expiration` (detik epoch). |
| 4 | `addDevice(…, { expiresAt })`; test berjam tetap memakai perangkat yang masih hidup + kontrol positif di setiap test lewati. |
| 5 | Rujukan baris diperbaiki saat implementasi; pemetaan `check-in` = `webPathOf` N3 (sudah ada); rujukan HRIS = latar dari repo luar. |
| 6 | `REMINDER_SCHOOL_SELECT` lengkap (id, timezone, jam buka/masuk/toleransi/tutup/akhir, mask, lead); `await loadCalendarContext`; daftar ENUM 26 nilai ditulis penuh di migrasi. |
| 7 | Jendela kirim `[menit kirim, jam masuk − 1)` + `kickPushDispatch()` sesudah commit tiap sekolah; jendela kosong (buka = masuk − 1) → tidak pernah (test). |
| 8 | Kedaluwarsa = **jam masuk + toleransi** (batas tercatat hadir); teks menyebut batas itu. |
| 9 | Isi: "Jam masuk 07:00. Absen begitu tiba di sekolah, paling lambat 07:15 agar tercatat hadir."; kartu memakai "notifikasi HP"; toast "pengingat hari ini segera dikirim" bila jendela hari ini sedang terbuka. |
| 10 | `dedupKey = attendance-reminder:<tanggal>` (N4) menggantikan anti-join `notifications none`; test dua penulisan langsung = satu baris. |
| 11 | Jangkauan = `loadReachableDevices` (bendera web dari transport aktif, definisi dispatcher) untuk job & GET. Membatasi ke perangkat HP saja dicatat di backlog. |
| 12 | `tick-runner.test.ts`/`schedule.test.ts` diperbarui; `sweepCheckedInReminders` diekspor & diuji langsung. |
| 13 | Indeks `[type, createdAt]` + retensi 30 hari untuk tipe push-only di `maintenance-daily`; volume (±1 baris per siswa terjangkau per hari sekolah) dicatat di backlog. |
| 14 | Kartu dipasang dengan `key={schoolId:version}` (jadwal yang baru diubah langsung terbaca); `DEMO_MESSAGE`/`SecurityCard` sudah di modul bersama (N2); jembatan N3 hanya membuang `notif` (absen=1 tetap); `markRead` baris push-only tetap 200 (sudah dibaca), detail 404. |

Catatan implementasi: kategori `ATTENDANCE` (00-integration keputusan 1) untuk `ATTENDANCE_REMINDER`; tipe push-only
(`PUSH_ONLY_TYPES`) ditulis sudah dibaca dan disaring dari daftar & detail kotak masuk; check-in yang diterima menandai
pengingat PENDING miliknya `OBSOLETE` di transaksi yang sama. Pertanyaan pemilik §10.2–10.3 memakai default (tanpa
pengingat kedua, tanpa pilihan per siswa).


Order: last in the batch (after N3 Web Push). Migration prefix `20261003060000`.

## 1. Goal & non-goals

**Goal.** Once per school per local date, at `startMinute − leadMinutes` (never earlier than `checkInOpenMinute`), send one push ("Kamu belum absen hari ini") to each student who still has to check in. A student qualifies only if all of these are true: today is a real school day for that school (`checkSchoolDay`), the student is ACTIVE and eligible, their user account is active, they have no Attendance row today, no PENDING or APPROVED leave covers today, and they have at least one push device. The reminder is push-only. Its Notification row is written already read, never shows in the inbox, expires at the bell, and is voided when the student checks in. School admins choose on/off and the lead minutes.

**Non-goals.** No second reminder (after the bell or near the late threshold). No check-out reminder, since check-out does not exist. No per-student opt-out. No reminders to admins. No catch-up when the window was missed: a missed slot is skipped, never sent late. Test mode does not change anything here. No new push transport: delivery depends on N3 Web Push and on Expo once EAS is ready.

## 2. Existing code to reuse/change

| Path:line | Use / change |
|---|---|
| `src/lib/jobs/types.ts:4` `JOB_NAMES` | Insert `"attendance-reminder"` right after `"attendance-auto-alpha"`. |
| `src/lib/jobs/schedule.ts:40-45` `JOB_CADENCE` | `"attendance-reminder": "EVERY_TICK"` (queue job that keys its own JobRun per school/date, like auto-alpha). |
| `src/lib/jobs/registry.ts:7-26` | Lazy handler `(await import("@/lib/attendance/reminder-job")).runAttendanceReminders(ctx)`. |
| `src/lib/jobs/runner.ts:58` `runKeyedJob` | Mutex and idempotency per (`"attendance-reminder"`, schoolId, localDate). |
| `src/lib/attendance/auto-alpha-job.ts:51-53` `schoolFilter` | Move it to new `src/lib/jobs/scope.ts` as `schoolScopeFilter(ctx)`. Both jobs use it. |
| `src/lib/attendance/auto-alpha-job.ts:56-63` | Pattern for the batched settled-key pre-check. Reuse `isSettledRun` from `auto-alpha-rules.ts:269`. |
| `src/lib/attendance/auto-alpha-rules.ts:289,293` `eligibilityCutoff`/`isEligibleOn` | The single definition of "wajib absen". Reuse it. |
| `src/lib/calendar/rules.ts:157` `checkSchoolDay`, `src/lib/calendar/queries.ts:49` `loadCalendarContext` | Checks mask, holiday and term for the date. |
| `src/lib/time/zone.ts:28,74,99` `localParts`/`instantAtLocal`/`formatMinute` | Local minute, local date, bell instant, "07:00". |
| `src/lib/attendance/retention.ts:70` `hasTimeLeft` | Tick deadline between schools. |
| `src/lib/push/delivery.ts:20` `loadDevices` | Builds the reachable set. **After N3, use whatever loader `processClaim` uses at `src/lib/push/dispatch.ts:62`** so "reachable" stays the dispatcher's definition (Expo + Web Push). |
| `src/lib/notifications/notify.ts:10-19,34-45` | `NotificationEvent` gains `pushExpiresAt?: Date`. Rows set `readAt: isPushOnlyType(type) ? ctx.now : null` and `pushExpiresAt: event.pushExpiresAt ?? null`. |
| `src/lib/notifications/rules.ts:87-111` | `CATEGORY_BY_TYPE.ATTENDANCE_REMINDER = "STUDENT_AFFAIRS"`. New `PUSH_ONLY_TYPES = ["ATTENDANCE_REMINDER"] as const` and `isPushOnlyType(type)`. |
| `src/lib/notifications/inbox-filters.ts:53-62` | `buildInboxWhere` adds the part `{ type: { notIn: [...PUSH_ONLY_TYPES] } }`. |
| `src/lib/notifications/queries.ts:209-213` `getInboxItem` | Add `type: { notIn: [...PUSH_ONLY_TYPES] }` to the where. A hidden row returns 404. `unreadCounts` needs no change because the row is already read. |
| `src/lib/push/claim.ts:138-146` | `CLAIM_SELECT` adds `pushExpiresAt: true`. |
| `src/lib/push/rules.ts:302-304` `isExpired` | New signature `isExpired(row: { createdAt: Date; pushExpiresAt: Date \| null }, now)`. Returns true if `pushExpiresAt !== null && now >= pushExpiresAt`, or if older than 60 min. Update `dispatch.ts:60-61`. |
| `src/lib/push/constants.ts:342` `PUSH_ERROR` | Add `OBSOLETE: "OBSOLETE"`. |
| `src/lib/attendance/check-in-service.ts:247-249` `writeInTx` | After `flagSharedDevice` (CREATED path only), call `expireAttendanceReminders(tx, [student.userId])`. Notification is written last, which matches the lock order in `src/lib/tx.ts:8-13`. |
| `src/lib/schools/theme-service.ts:18-51`, `src/app/api/v1/school/theme/route.ts` | Template for the settings endpoint: `resolveSchoolScope`, `lockKey(schoolConfigLockKey)` (`service.ts:28`), no-op means no audit. |
| `src/components/hub/workspace.tsx:60` | Mount the panel as the `SecurityPanel` precedent does. |
| `src/lib/frontend/workspace-rules.ts:133-155` | New `PANEL_OPERATIONS` set, excluded in `viewsFor` and `pageActions`. |
| `src/lib/frontend/demo.ts:63-64` | Add a demo branch **before** `path.includes("attendance")`. Without it the reminder path would return monitor rows. |

## 3. Data model

`prisma/schema/school.prisma` (School, after `schoolDaysMask`):
```prisma
  /// Pengingat absen (N5): push ke siswa yang belum absen `attendanceReminderLeadMinutes` menit sebelum jam
  /// masuk (tidak lebih awal dari jam buka absen), sekali per tanggal lokal, hanya hari sekolah.
  attendanceReminderEnabled     Boolean @default(true)
  attendanceReminderLeadMinutes Int     @default(15) @db.SmallInt
```
`prisma/schema/notification.prisma`: append `ATTENDANCE_REMINDER` as the **last** `NotificationType` value, after N4's values. Notification gets:
```prisma
  /// Push tidak relevan lagi setelah waktu ini (pengingat absen = jam masuk). NULL = batas umur 60 menit.
  pushExpiresAt     DateTime?
```
Folder `prisma/migrations/20261003060000_attendance_reminder/migration.sql`:
```sql
-- Pengingat absen (N5, keputusan pemilik 2026-10-03). Aditif saja: dua kolom School ber-DEFAULT (ADD COLUMN
-- instan MariaDB 10.11), satu kolom DATETIME nullable di Notification, dan nilai enum baru di UJUNG
-- daftar Notification.type (perluasan ENUM di ujung = instan; ALGORITHM=INSTANT menggagalkan migrasi bila tidak).
-- Default: pengingat aktif, 15 menit sebelum jam masuk.
ALTER TABLE `School`
  ADD COLUMN `attendanceReminderEnabled` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `attendanceReminderLeadMinutes` SMALLINT NOT NULL DEFAULT 15;
ALTER TABLE `School` ADD CONSTRAINT `chk_school_reminder_lead` CHECK (`attendanceReminderLeadMinutes` BETWEEN 5 AND 120);

ALTER TABLE `Notification` ADD COLUMN `pushExpiresAt` DATETIME(3) NULL;

-- Salin daftar ENUM PERSIS dari migrasi terakhir yang mengubah Notification.type (N4), lalu tambah di ujung.
ALTER TABLE `Notification` MODIFY `type` ENUM('ANNOUNCEMENT', 'INVOICE_ISSUED', 'PAYMENT_SUBMITTED', 'PAYMENT_APPROVED', 'PAYMENT_REJECTED', 'LEAVE_SUBMITTED', 'LEAVE_APPROVED', 'LEAVE_REJECTED', 'REPORT_CARD_PUBLISHED', 'SPONSOR_APPROVED', 'SPONSOR_SUSPENDED', 'AD_SUBMITTED', 'AD_APPROVED', 'AD_REJECTED', 'TOPUP_SUBMITTED', 'TOPUP_APPROVED', 'TOPUP_REJECTED', 'LOW_BALANCE', 'ATTENDANCE_CORRECTED', 'INVOICE_VOIDED', 'PAYMENT_VOIDED', 'NISN_RELEASED', 'SCHOOL_SETTINGS_CHANGED', /* <nilai N4 apa adanya> */ 'ATTENDANCE_REMINDER') NOT NULL, ALGORITHM=INSTANT;
```
The implementer removes the placeholder comment and pastes N4's values in schema order. Integration tests insert `ATTENDANCE_REMINDER`, so a list mismatch fails CI.

## 4. Pure rules — `src/lib/attendance/reminder-rules.ts` (+ `reminder-rules.test.ts`, written first)

```ts
export const ATTENDANCE_REMINDER_JOB = "attendance-reminder";        // JobRun.job
export const REMINDER_LEAD_MIN = 5, REMINDER_LEAD_MAX = 120, DEFAULT_REMINDER_LEAD_MINUTES = 15;
export interface ReminderSchedule { timezone: SchoolTz; checkInOpenMinute: number; startMinute: number;
  schoolDaysMask: number; attendanceReminderLeadMinutes: number }
/** max(start − lead, open); always < start because open < start (chk_school_schedule). */
export function reminderSendMinute(s: Pick<ReminderSchedule, "checkInOpenMinute"|"startMinute"|"attendanceReminderLeadMinutes">): number;
/** null unless the weekday bit is in the mask AND sendMinute <= local minute < startMinute. */
export function reminderSlot(now: Date, s: ReminderSchedule): { date: LocalDate; expiresAt: Date } | null; // expiresAt = instantAtLocal(date, startMinute, tz)
export interface ReminderCandidate { id: string; userId: string; status: StudentStatus; activatedAt: Date | null }
export interface BlockingLeave { studentId: string; startDate: LocalDate; endDate: LocalDate } // PENDING|APPROVED
/** userIds (unique, ascending): isEligibleOn && no blocking leave covering date && reachable.has(userId). */
export function planReminderRecipients(date: LocalDate, candidates: readonly ReminderCandidate[],
  leaves: readonly BlockingLeave[], policy: EligibilityPolicy, reachable: ReadonlySet<string>): string[];
```
Tests to write first:
- `reminderSendMinute`: 420/360/15 → 405; lead 60 → 360; lead 120 → 360 (clamped).
- `reminderSlot`: 06:44 WIB → null. 06:45 → slot with `date` = local date and `expiresAt` = 07:00 local. 06:59 → slot. 07:00 → null. 07:30 → null. Saturday with mask 31 → null.
- WIT school at `2031-03-17T21:50Z` → date `2031-03-18`. This is the HRIS 7aac422 UTC lesson.
- `planReminderRecipients`: excludes INACTIVE; excludes `activatedAt` ≥ cutoff; excludes PENDING leave covering; excludes APPROVED leave covering; includes a leave that ends yesterday; excludes unreachable; dedupes and sorts.

Template `src/lib/notifications/templates/attendance-reminder.ts` (+ test): `attendanceReminderEvent({ date, startMinute, expiresAt }): NotificationEvent` returns `{ type: "ATTENDANCE_REMINDER", title: "Kamu belum absen hari ini", body: "Jam masuk pukul 07:00. Absen sekarang agar tercatat hadir tepat waktu.", link: { screen: "check-in", id: date }, pushExpiresAt: expiresAt }`. Test: the text, the link, the expiry, and body ≤ `PUSH_BODY_MAX`.

Also: `rules.test.ts` covers category and `isPushOnlyType`. `inbox-filters.test.ts` checks the notIn part. `push/rules.test.ts` covers `isExpired` with `pushExpiresAt` (before → false, equal → true, null → 60-min rule).

## 5. API & job flow

**GET `/api/v1/school/settings/attendance-reminder`**: contract `getAttendanceReminderSettings`, action `schools.profile.read` (ADMINS), `query: schoolScopeQuery`.
**PUT same path**: contract `updateAttendanceReminderSettings`, action `schools.settings.update` (ADMINS, which includes extra admin accounts, same as the schedule). Body `z.strictObject({ enabled: z.boolean(), leadMinutes: z.int().min(5).max(120) })`.
Both return `AttendanceReminderSettings`:
`{ enabled, leadMinutes, checkInOpenMinute, startMinute, sendMinute, timezone, activeStudentCount, pushReadyStudentCount }`.
Errors: 400 `VALIDATION_FAILED` (range, missing or extra key), 400 `SCHOOL_ID_REQUIRED` (SA without `?schoolId`), 403 `SCOPE_MISMATCH`, 404 (SA, unknown school), 403 for STUDENT and SPONSOR.
Files: `src/lib/schools/reminder-schemas.ts`, `reminder-service.ts`; contracts in `src/lib/schools/contracts.ts` and `schoolsContracts`; route `src/app/api/v1/school/settings/attendance-reminder/route.ts` (`defineRoute` + `resolveSchoolScope`, as in the theme route).
Service PUT: `withTx`, then `lockKey(tx, schoolConfigLockKey(id))`, then read the School row (School *is* the tenant: `findUnique({id: scope.schoolId})` as in `theme-service.ts:35`), then compare. If nothing changed, return without writing or auditing. Otherwise `update` + `writeAudit({action:"school.attendance_reminder_update", entityType:"School", before:{enabled,leadMinutes}, after})`. No notification, following the theme precedent. Counts on GET: ACTIVE students (with active user), and how many of them the device loader reports reachable.
After the contract change: `pnpm openapi:export`, `pnpm frontend:sync`. The inbox `type` enum also changes in OpenAPI.

**Job `src/lib/attendance/reminder-job.ts`**
- `runAttendanceReminders(ctx)` (≤50 lines):
  1. `school.findMany({ where:{ isActive:true, attendanceReminderEnabled:true, ...schoolScopeFilter(ctx) }, select: REMINDER_SCHOOL_SELECT, orderBy:{id:"asc"} })`.
  2. `due` = schools with a non-null `reminderSlot(ctx.now, s)`.
  3. Settled pre-check: one `jobRun.findMany({ job, scopeKey in ids, runKey in dates })` filtered by `isSettledRun`.
  4. For each unsettled school: run `hasTimeLeft(ctx.deadline)`, else set `hasMore`. Then `runKeyedJob(ATTENDANCE_REMINDER_JOB, school.id, slot.date, () => sendSchoolReminders(school, slot, ctx), ctx)`.
  5. Return `{ schools, due, ran, skipped, failed, hasMore }`.
- `sendSchoolReminders`: `withTx(…, { timeout: 30_000 })`, no AppLock (the JobRun claim is the mutex):
  1. `checkSchoolDay(date, loadCalendarContext(tx, school, {from:date,to:date}))`. On a non-school day, return `{ date, skipped:"NON_SCHOOL_DAY", reason }`.
  2. Candidates: `tx.student.findMany({ where:{ schoolId, status:"ACTIVE", activatedAt:{lt: eligibilityCutoff(date, school)}, attendances:{none:{date:day}}, user:{ isActive:true, notifications:{ none:{ type:"ATTENDANCE_REMINDER", createdAt:{ gte: instantAtLocal(date,0,tz) } } } } }, select:{id,userId,status,activatedAt} })`. The `notifications none` clause makes the job idempotent per student per date even after a stale-RUNNING takeover.
  3. Leaves: `tx.leaveRequest.findMany({ where:{ schoolId, status:{in:["PENDING","APPROVED"]}, startDate:{lte:day}, endDate:{gte:day} } })`.
  4. `reachable` = keys of the device loader for the candidate userIds.
  5. `planReminderRecipients`.
  6. `notifyRecipients(tx, ids as STUDENT, attendanceReminderEvent(...), { now })`. Rows are PENDING, read, and carry `pushExpiresAt` = bell. No kick: `push-dispatch` sends on the next tick (≤60 s).
  7. Post-insert sweep: load the Attendance rows for (school, day, recipient studentIds) and call `expireAttendanceReminders(tx, theirUserIds)`. This closes most of the check-in race.
  8. Return `{ date, candidates, unreachable, recipients, obsolete }` (stored in `JobRun.result`).
- `src/lib/attendance/reminder-expiry.ts`: `expireAttendanceReminders(tx, userIds)` does `notification.updateMany({ where:{ userId:{in}, type:"ATTENDANCE_REMINDER", pushStatus:"PENDING" }, data:{ pushStatus:"SKIPPED", pushError: PUSH_ERROR.OBSOLETE } })` (index `[userId,type,createdAt]`).
- **Must not** import `test-mode.ts`. Reminders always follow the real calendar and schedule.

## 6. UI

New `src/components/hub/attendance-reminder-card.tsx` (security-card styling). It is mounted in `workspace.tsx` as `{module.key === "school-settings" && !needsSchool && <AttendanceReminderCard />}`. Add both operation ids to `PANEL_OPERATIONS` so they never appear as a tab or button. Still add `VIEW_LABELS.getAttendanceReminderSettings = "Pengingat absen"` and `ACTION_LABELS.updateAttendanceReminderSettings = { label: "Atur pengingat absen" }`.

| State | Copy |
|---|---|
| Loading | 2 skeleton lines |
| Error | "Pengaturan pengingat belum termuat." + **Coba lagi** button on the same line |
| On | Title "Pengingat absen". Line: "Siswa yang belum absen menerima push pukul **06:45** — 15 menit sebelum jam masuk 07:00." |
| Clamped | "Jam buka absen 06:00, jadi pengingat dikirim saat absen dibuka." |
| Off | "Mati — siswa tidak menerima pengingat absen." |
| Reach | "1.012 dari 1.284 siswa aktif bisa menerima push. Siswa iPhone harus menambahkan studenthub.id ke Layar Utama dan mengizinkan notifikasi." (Information only, so no CTA.) |

Controls: checkbox "Kirim pengingat absen"; `NumericField` "Menit sebelum jam masuk" (5–120, disabled when off); the preview updates live through `reminderSendMinute` (pure, safe for the client); a **Simpan** button sits next to the fields and is disabled when nothing changed. Success toast: "Tersimpan — pengingat berikutnya pukul 06:45." (when off: "Tersimpan — pengingat absen dimatikan."). Errors show inline beside the button.

Demo: GET comes from `demoRows("/school/settings/attendance-reminder")`, which returns `{ enabled:true, leadMinutes:15, checkInOpenMinute:360, startMinute:420, sendMinute:405, timezone:"WIB", activeStudentCount:1284, pushReadyStudentCount:1012 }`. That branch goes before `demo.ts:64`. Simpan in demo shows the standard demo message (`action-dialog.tsx:74`) next to the button.

Labels in `src/lib/frontend/field-labels.ts`: `leadMinutes: "Menit sebelum jam masuk"`, `sendMinute: "Pengingat dikirim"`, `pushReadyStudentCount: "Siswa siap menerima push"`. Add `sendMinute` to `CLOCK_MINUTE_FIELDS` (`format.ts:24`).

Student: no new UI. N3's service-worker screen map must add `"check-in"` → `/hub/my-attendance?absen=1`, which already opens the check-in flow (`attendance-page.tsx:38`). The push itself is the CTA.

## 7. Tests

Unit: section 4 files; `jobs/schedule.test.ts` and `registry.test.ts` (new job, `runKey` null); `workspace-rules.test.ts` (panel ops excluded from views and actions; the reachability test at line 90 treats `PANEL_OPERATIONS` as reachable); `demo.test.ts` (the reminder path returns the DTO, not attendance rows).

Integration (fixed dates in 2031, `createAttendanceSchool({ data: { schoolDaysMask: 31, … } })`, `addDevice` from `tests/integration/push/helpers.ts`):
- `tests/integration/attendance/jobs/attendance-reminder.test.ts`:
  - In window (`2031-03-17T23:50Z` = Tue 06:50 WIB): exactly one row with `readAt` set, PENDING, `pushExpiresAt = 2031-03-18T00:00Z`, data `{screen:"check-in",id:D}`; JobRun SUCCEEDED with the result counts.
  - Skips: checked-in, INACTIVE, user inactive, PENDING leave, APPROVED leave, no device, activated after cutoff.
  - Second tick: no new rows, one JobRun.
  - 06:44, 07:00 and 07:30: no JobRun.
  - Holiday → `NON_SCHOOL_DAY/HOLIDAY`; no term → `OUTSIDE_TERM`; Saturday with mask 31 → no JobRun.
  - Reminder disabled → nothing. Lead 120 → window starts 06:00. WIT `runKey` uses the local date.
  - Test mode ON + holiday → nothing (restore state in `finally`).
  - A pre-existing reminder today is not duplicated.
  - Post-insert sweep marks a row created for a student checked in by the fixture between calls (call the inner `sendSchoolReminders` directly).
- `tests/integration/push/dispatch.test.ts`: reminder with past `pushExpiresAt` → SKIPPED `EXPIRED`, nothing sent; OBSOLETE rows are not claimed.
- `tests/integration/attendance/checkin/check-in-service.test.ts`: an accepted check-in turns that user's PENDING reminder into SKIPPED `OBSOLETE`; other users' rows and SENT rows are untouched; REPLAY does not touch them.
- `tests/integration/notifications/inbox-list.test.ts`: the reminder is absent from the list, the unread count is unchanged, and GET `/notifications/{id}` returns 404.
- `tests/integration/schools/attendance-reminder-settings.test.ts`: defaults (true/15/405); PUT plus audit; same values → no audit; 4/121/missing/extra key → 400; scope 403/404/400; STUDENT 403; counts.
- `tests/integration/jobs/runner.test.ts`: tick results include `attendance-reminder`.

Browser: `tests/browser/frontend.spec.ts` gets "pengingat absen (demo)". The demo admin opens Pengaturan sekolah and sees "06:45". Changing the minutes updates the preview. Simpan shows the demo message. No `e2e/` change (request-level smoke only).

## 8. Docs

- `docs/PLAN.md`:
  - "Pengumuman & notifikasi": add "Pengingat absen (keputusan pemilik 2026-10-03): push sekali per hari sekolah ke siswa yang belum absen, N menit sebelum jam masuk; push-only (tidak masuk inbox), kedaluwarsa saat jam masuk/siswa absen".
  - "File & job": add `attendance-reminder` to the tick list.
- `docs/backlog.md` "Tambahan": second reminder before the late threshold; per-student opt-out; void the reminder on admin entry or leave creation; shorter retention for reminder rows (needs an index `[type, createdAt]`); Expo screen `check-in`. Each with a trigger.
- `docs/FRONTEND.md`: the Admin sekolah row mentions "pengingat absen" in Pengaturan sekolah; add a short "Pengingat absen" subsection (iPhone needs Layar Utama; push opens `?absen=1`; demo behaviour).
- `docs/design/02-attendance.md`: new §3.11 with the algorithm from section 5 and the test-mode independence.
- `docs/design/05-platform-crosscutting.md`: job list (lines 78 and 397); push rule at line 291 ("`pushExpiresAt` lewat → EXPIRED; OBSOLETE"); push-only types are hidden from the inbox.

## 9. Edge cases, risks, HRIS lessons

- **Race between the candidate read and a check-in**: handled by the post-insert sweep plus the check-in-side OBSOLETE update. A window of a few milliseconds remains (accepted; documented in §3.11).
- **Tick missed or app down through the window**: no reminder (TOLERANSI_TELAT lesson, `pengingatAbsen.ts:81`).
- **Push retries after the bell**: backoff of 1/5/30 min would deliver late, so `pushExpiresAt` = bell → EXPIRED.
- **JobRun RUNNING takeover after 15 min** (lead > 15): the `notifications none` clause prevents duplicates.
- **Schedule edited after today's run**: SUCCEEDED means no second push. Edited before the run: the new window applies.
- **Lead larger than start − open**: clamped to open; the UI says so.
- **Test mode**: ignored. Test mode lets testers check in on holidays, but reminders never fire on non-school days. A tester who checked in has a row, so they are skipped.
- **Volume**: one row per reachable, not-yet-checked-in student per day. Shares the 365-day notification retention; unreachable students get no rows. Risk: table growth. Mitigation is a backlog item.
- **Deadlock**: the check-in `updateMany` against the dispatcher claim. Claims use SKIP LOCKED and `withTx` retries P2034.
- **N2/N3 coupling**: if N2 adds preference filtering inside `notifyRecipients`, students and `ATTENDANCE_REMINDER` must pass through. If N3 changes `initialPushStatus`, STUDENT stays PENDING.
- **Biggest risk**: Default ON pushes every reachable student at all live schools from the first school day after deploy. Mitigation: open question 1, a 15-min lead, one push per day, and an admin switch.
- **HRIS lessons applied**:
  - Slot claim through the `app_setting` string `includes` (`pengingatAbsen.ts:57-68`, not atomic) → replaced by the JobRun unique key.
  - Skip holidays, approved and pending leave (`:92-116`) → `checkSchoolDay` plus the PENDING/APPROVED filter.
  - Push-only rationale (`:15`) → kept, but with an outbox row so retry, expiry and observability still work.
  - Per-employee N+1 shift queries (`:122-127`) → set-based queries.
  - Cron hours written in UTC (`7aac422`) → per-minute UTC tick plus `localParts` per school, with a WIT boundary test.
  - "Don't nag on guesses" (`633d563`/`cae864c`) → only send on facts (calendar, row, leave, device). No term means silence. Void on check-in.

## 10. Open questions (owner)

1. Should reminders be on by default for existing schools? **Default: ON, 15 min** (one push per day, only to opted-in devices, admins can turn it off). The alternative is OFF until each school enables it.
2. Should there be a second reminder just before the late threshold (start + tolerance)? **Default: no.**
3. Should students be able to opt out themselves? **Default: no** (school-level switch only).
