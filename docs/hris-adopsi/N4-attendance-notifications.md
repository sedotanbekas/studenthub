# N4 — Notifikasi peristiwa absensi (spec)

## 0. Revisi setelah kritik (2026-10-03) — berlaku di atas draf di bawah

Sumber: `N4-attendance-notifications.critique.md` + keputusan lintas fitur `00-integration.md` §2. Semua temuan diterima;
yang mengubah desain:

| # Kritik | Keputusan (sudah diimplementasikan) |
|---|---|
| 1 | **Alpa massal ditahan.** `holdAlphaNotices({checkins, alpha})` (`day-notice-rules.ts`): tanggal tanpa satu pun baris ber-`checkInAt` -> notifikasi Alpa ke siswa TIDAK dikirim (libur belum dicatat, sekolah belum memakai absen aplikasi, gangguan; push tidak bisa ditarik). Rekap admin tetap dikirim dengan kalimat `ALPHA_HOLD_LINE` ("… notifikasi Alpa ke siswa ditahan. Libur? Tambahkan di Kalender."). Ambang di atas 0 = pertanyaan pemilik 6. |
| 2 | **Kategori baru `ATTENDANCE` ("Kehadiran")** untuk `ATTENDANCE_ALPHA` dan `ATTENDANCE_DAY_SUMMARY` (00-integration keputusan 1; `ATTENDANCE_CORRECTED` tetap Kesiswaan). Ditambahkan di migrasi N4 (N2 sudah terbit): MODIFY `Notification.category`, `Announcement.category`, `NotificationMute.category` (di ujung, INSTANT). `ADMIN_MUTABLE_CATEGORIES` += ATTENDANCE, `SCHOOL_ADMIN_BROADCAST_TYPES` += ATTENDANCE_DAY_SUMMARY, `CATEGORY_HINTS.ATTENDANCE` = "Rekap kehadiran harian: Alpa, terlambat, anomali.", label enum "Kehadiran". Mematikan Kesiswaan tidak lagi membuang rekap. Pengumuman tetap dibatasi zod ke kategori lama (skema keluaran pengumuman memuat enum lengkap). |
| 3 | **Penarikan per potongan sekolah** (`retractDayNotices(tx, schoolIds, studentIds, dates)` dipanggil di tiap potongan 50 sekolah `deleteDerivedRows`): Alpa milik siswa yang baris turunannya (AUTO_ALPHA **atau LEAVE**) dihapus, dan rekap harian SEMUA admin sekolah di potongan itu — walau sekolah itu tidak punya baris turunan. Hanya hitungan yang dikembalikan; audit `attendance.calendar_sync.after.retractedNotices` (audit juga ditulis bila hanya ada penarikan). |
| 4 | Kueri ulang AUTO_ALPHA hanya membuang pemenang check-in/izin/koreksi; penutup bersamaan diredam indeks unik `(userId, dedupKey)`. `NOTIFICATION_DEDUP_KEY_MAX = 64` + `assertDedupKey` (kunci kosong / > 64 -> RangeError, test unit & integrasi). Kedua tipe dibaca balik lewat `toInboxItemDto` di test integrasi. Indeks: `ADD UNIQUE INDEX …, ALGORITHM=INPLACE, LOCK=NONE`; kolom: `ALGORITHM=INSTANT`. Penerima diurut `userId` (urutan sisip deterministik). |
| 5 | Hitungan "perlu ditinjau" = `{ schoolId, date, ...PENDING_ANOMALY_REVIEW_WHERE }` (indeks B1 `[schoolId, hasAnomaly, anomalyReviewedAt, date]`), tanpa cabang cadangan. Fixture `checkInRow` sudah punya `hasAnomaly` (B1); test menyetel `lastLoginAt` siswa. |
| 6 | Test admin memakai `pushStatus === initialPushStatus("SCHOOL_ADMIN")` (tahan perubahan N3). `demoUnreadCount(viewer?)` menghitung kotak masuk persona yang sama dengan daftar (hook badge mengirim persona). Pemetaan layar push (`attendance-alpha` -> `/hub/my-leave`, `attendance-day` -> `/hub/attendance`) dicatat untuk N3 (00-integration keputusan 7); N5 memakai `dedupKey` (keputusan 9). |
| 7 | Judul Alpa bertanggal: **"Alpa pada Selasa, 18 Maret"** (isi tetap lengkap dengan tahun & tenggat). Rekap: "**3 perlu ditinjau.**" (kosakata B1). Teks kontrak: "notifikasi Alpa ke siswa (≤ 3 hari) & rekap ke admin (≤ 1 hari)". Tanggal demo = hari sekolah demo sebelumnya (`previousDemoSchoolDay`, melewati Minggu). CTA memakai `earliestLeaveStart(today, "STUDENT")` (bukan angka 7) dan membawa petunjuk "Sudah mengajukan? Lihat di menu Izin & sakit." untuk kasus `LEAVE_OVERLAP`. Alpa vs Alpha tetap pertanyaan pemilik (§10.5). |

Catatan implementasi:
- `notifyDayClosed` dipanggil di `closeDayLocked` setelah sapuan SHARED_DEVICE; jalur siswa langsung memakai `userId`
  dari kueri ulang (`notifyRecipients`), tanpa kueri Student kedua. Hitungan "check-in" = baris ber-`checkInAt`
  (koreksi admin atas baris check-in tetap terhitung).
- Intent URL `?ajukan=` / `?tanggal=` lewat `useUrlDateIntent` (`src/components/hub/use-url-intent.ts`): parameter
  dibuang saat intent dijalankan (setelah transisi halaman), sehingga efek ganda StrictMode tidak menghilangkannya.
- Kartu bertindakan menandai notifikasi dibaca (best-effort) lalu menyegarkan badge N1.

Jawaban default §10 dipakai, kecuali §10.1 (diputuskan: kategori baru ATTENDANCE). Pertanyaan pemilik tambahan:
6. **Ambang penahanan Alpa massal.** *Default:* tahan hanya bila 0 check-in pada tanggal itu.


Order: after B1 and N2 (it uses both) and before N5, which appends its enum value after N4's. Migration prefix `20261003040000`.

## 1. Goal & non-goals

**Goal.** When a school day is closed, notify the people affected, inside the closing transaction and exactly once. (a) Each student newly marked Alpa by the closure gets **one** `ATTENDANCE_ALPHA` per date, with a CTA to submit izin/sakit before the student backdate limit runs out. If a PENDING leave already covers that date, the student gets different wording. (b) The school's admins get **one** `ATTENDANCE_DAY_SUMMARY` per school per day: alpa, terlambat, izin, sakit, and anomalies awaiting review (B1). It goes through N2's mute filter (category STUDENT_AFFAIRS). Re-closing a day (tick retry or takeover, super-admin re-close, calendar sync) never duplicates a notification. A holiday added retroactively withdraws the notices for that date.

**Non-goals.** No new endpoint, POLICY action or role. No late or anomaly notice per student. Lateness is shown at check-in, and B1 owns anomaly review. No per-class summary for teachers (there is no teacher↔class link). No quiet hours. No change to `DayCloseResult`, the JobRun result shape, or `recloseDayResponse`. No Web Push work (N3 owns delivery).

## 2. Existing code to reuse/change

| Path:line | Today | Change |
|---|---|---|
| `src/lib/attendance/auto-alpha-job.ts:138-150` `closeDayLocked` | Single close path for the tick (`closeSchoolDay` :153), super-admin re-close (`reclose-service.ts:34`) and stale calendar re-close (`calendar-sync.ts:110-121`) | After `sweepSharedDevice` (:147), call `notifyDayClosed(tx, school, date, alphaIds, ctx.now)`, where `alphaIds = drafts.filter(d => d.source === "AUTO_ALPHA").map(d => d.studentId)`. When the counts are > 0, call `log.info("auto-alpha: notifikasi hari ditutup", {...})`. Update the header comment (:30-40). |
| `auto-alpha-rules.ts:33,60-65,152-160` | 7-day catch-up; PENDING leave does not protect (ALPHA) | Reused, unchanged |
| `src/lib/attendance/calendar-sync.ts:67-81` `deleteDerivedRows` | Selects only `id`, then deletes | Select `{id, schoolId, studentId, date, source}`, collect the removed rows, and after the loop call `retractDayNotices(tx, removed)`. Return `{deleted, retracted}`. `onCalendarChanges` (:146) uses `deleted` as `affected`. `auditSync` adds `after.retractedNotices`. |
| `src/lib/notifications/notify.ts:10-19,29-53` | `skipDuplicates` only for `announcementId` | `NotificationEvent.dedupKey?: string`. Row `dedupKey: event.dedupKey ?? null`. `skipDuplicates: Boolean(event.announcementId ?? event.dedupKey)`. Sort `unique` by `userId` (deterministic insert order means fewer deadlocks). |
| `notify.ts:61-68` `notifyStudents`, `:70-73` `notifySchoolAdmins` | N2 adds the mute filter + primary-admin fallback | Reused as-is. N4 adds no preference logic. |
| `src/lib/notifications/rules.ts:4-28` | `CATEGORY_BY_TYPE`, a total map | `ATTENDANCE_ALPHA: "STUDENT_AFFAIRS"`, `ATTENDANCE_DAY_SUMMARY: "STUDENT_AFFAIRS"` |
| `src/lib/notifications/templates/attendance-admin.ts:23` | `formatIndonesianDate` | Reused by the new templates |
| `src/lib/attendance/leave-constants.ts:7`, `leave-rules.ts:29` | Student backdate of 7 days, `earliestLeaveStart` | Source of the CTA deadline |
| `src/lib/notifications/dto.ts:15` `toLinkData` | Passes `{screen,id,count?}` | Reused. Ids are a date or a leave id. |
| `src/lib/notifications/schemas.ts:48` | `z.enum(NotificationType)` | Enum grows, so run `pnpm openapi:export` and `pnpm frontend:sync` |
| `src/lib/attendance/contracts-admin.ts:34-39` | close-day description | Append: "Penutupan tanggal ≤ 3 hari lalu memberi notifikasi Alpa ke siswa & rekap ke admin, sekali per tanggal." |
| `src/components/hub/domain-views.tsx:16-18` `FeedView` | Whole card is a `<button>`, no CTA | CTA card variant (§6) |
| `src/components/hub/workspace.tsx:35,73-76` | `setAction({op, initial})`, so ActionDialog prefills (`action-dialog.tsx:64`) | URL intent `?ajukan=` for `my-leave` (§6) |
| `src/components/hub/attendance-admin/attendance-monitor-page.tsx:22` | Filter date = today | URL intent `?tanggal=` |
| `src/components/hub/student-home.tsx:36,67-69` | Feed titled "Pengumuman"; demo rows without persona | Heading "Kabar terbaru"; pass the persona |
| `src/lib/frontend/demo.ts:66` | One shared list for announcements & notifications | `/notifications` goes through the new `demo-notifications.ts` |
| `src/lib/frontend/workspace-rules.ts:28` | Label "Ajukan izin/sakit" | Same CTA copy |

## 3. Data model

`prisma/schema/notification.prisma`:
```prisma
enum NotificationType {
  // … existing values unchanged, including any appended by an earlier feature (B1) …
  SCHOOL_SETTINGS_CHANGED
  ATTENDANCE_ALPHA
  ATTENDANCE_DAY_SUMMARY
}
model Notification {
  // …
  /// Kunci idempoten notifikasi job (mis. "attendance-alpha:2026-10-03"); unik per penerima. NULL = tanpa dedup.
  dedupKey          String?              @db.VarChar(64)
  // …
  @@unique([userId, dedupKey])
}
```

Folder `prisma/migrations/20261003040000_attendance_notifications/migration.sql`:
```sql
-- Notifikasi peristiwa absensi (N4, keputusan pemilik 2026-10-03). Aditif saja:
-- 1) dua nilai NotificationType DI UJUNG daftar (perluasan ENUM di ujung = instan);
-- 2) kolom nullable `dedupKey` + indeks unik (userId, dedupKey): notifikasi Alpa per tanggal & rekap harian
--    tepat sekali per penerima walau hari ditutup ulang. NULL tidak saling bentrok di indeks unik, jadi
--    notifikasi lama & tipe lain tidak terpengaruh. Bila migrasi sebelumnya (mis. B1) menambah nilai
--    NotificationType, salin daftarnya PERSIS sebelum dua nilai N4.
ALTER TABLE `Notification` MODIFY `type` ENUM('ANNOUNCEMENT', 'INVOICE_ISSUED', 'PAYMENT_SUBMITTED', 'PAYMENT_APPROVED', 'PAYMENT_REJECTED', 'LEAVE_SUBMITTED', 'LEAVE_APPROVED', 'LEAVE_REJECTED', 'REPORT_CARD_PUBLISHED', 'SPONSOR_APPROVED', 'SPONSOR_SUSPENDED', 'AD_SUBMITTED', 'AD_APPROVED', 'AD_REJECTED', 'TOPUP_SUBMITTED', 'TOPUP_APPROVED', 'TOPUP_REJECTED', 'LOW_BALANCE', 'ATTENDANCE_CORRECTED', 'INVOICE_VOIDED', 'PAYMENT_VOIDED', 'NISN_RELEASED', 'SCHOOL_SETTINGS_CHANGED', 'ATTENDANCE_ALPHA', 'ATTENDANCE_DAY_SUMMARY') NOT NULL, ALGORITHM=INSTANT;

ALTER TABLE `Notification` ADD COLUMN `dedupKey` VARCHAR(64) NULL;

CREATE UNIQUE INDEX `Notification_userId_dedupKey_key` ON `Notification`(`userId`, `dedupKey`);
```
The `MODIFY` only appends enum values, the sanctioned exception in CLAUDE.md. The column add is instant, and the unique index is built online (INPLACE). Check the SQL with `prisma migrate diff --from-schema <HEAD> --to-schema prisma/schema --script`, then run `prisma validate`.

## 4. Pure rules (tests written first)

`src/lib/attendance/day-notice-rules.ts` (no Prisma):
```ts
/** Notifikasi Alpa hanya untuk tanggal ≤ 3 hari lalu (catch-up 7 hari tidak menyerbu siswa). */
export const ALPHA_NOTICE_MAX_AGE_DAYS = 3;
/** Rekap admin hanya untuk hari ini/kemarin. */
export const DAY_SUMMARY_MAX_AGE_DAYS = 1;
export const alphaNoticeKey = (date: LocalDate) => `attendance-alpha:${date}`;
export const daySummaryKey = (date: LocalDate) => `attendance-summary:${date}`;
export function isFreshClose(date: LocalDate, today: LocalDate, maxAgeDays: number): boolean; // addDays(today,-max) ≤ date ≤ today
export function leaveDeadlineFor(date: LocalDate): LocalDate; // addDays(date, LEAVE_MAX_BACKDATE_DAYS)
export interface PendingLeaveRef { readonly id: string; readonly studentId: string; readonly type: LeaveTypeValue; readonly startDate: LocalDate; readonly endDate: LocalDate }
export interface AlphaNoticePlan { readonly plain: readonly string[]; readonly pending: readonly { studentId: string; leaveId: string; type: LeaveTypeValue }[] }
export function planAlphaNotices(date: LocalDate, alphaStudentIds: readonly string[], pending: readonly PendingLeaveRef[]): AlphaNoticePlan;
export interface DayCounts { readonly alpha: number; readonly late: number; readonly izin: number; readonly sakit: number; readonly pendingAnomalies: number }
export function dayCountsFrom(groups: readonly { status: AttendanceStatus; count: number }[], pendingAnomalies: number): DayCounts;
/** Rekap dikirim hanya bila ada yang perlu ditindaklanjuti. */
export function isNotableDay(c: DayCounts): boolean; // alpha + late + pendingAnomalies > 0
```
Tests in `day-notice-rules.test.ts`:
1. `isFreshClose`: age 0 → true; age 3 (max 3) → true; age 4 → false; a future date → false; with max 1, yesterday → true and 2 days ago → false.
2. Invariant: `ALPHA_NOTICE_MAX_AGE_DAYS < LEAVE_MAX_BACKDATE_DAYS`, so every notice that is sent has a CTA that still works.
3. `leaveDeadlineFor("2031-03-18") === "2031-03-25"`, and `earliestLeaveStart(deadline,"STUDENT") === date`.
4. `planAlphaNotices`: ids are deduplicated and sorted. A PENDING leave covering the date → `pending`. A leave that does not cover the date, or belongs to a student not in the list, is ignored. With two pending leaves, the earliest `startDate` wins, then the lower id (same tie-break as `leavesCovering`, `auto-alpha-rules.ts:128`).
5. `dayCountsFrom`: maps ALPHA/TERLAMBAT/IZIN/SAKIT, ignores HADIR, and missing statuses count as 0.
6. `isNotableDay`: all zero → false; only izin/sakit → false; alpha, late or anomalies equal to 1 → true.

`src/lib/notifications/templates/attendance-day.ts` (+ test; client-safe, type-only imports):
- `attendanceAlphaNotification({date})` → type `ATTENDANCE_ALPHA`, title **"Kamu tercatat Alpa"**, body **"Kamu tercatat Alpa pada Selasa, 18 Maret 2031. Bila berhalangan, ajukan izin/sakit paling lambat Selasa, 25 Maret 2031."**, link `{screen:"attendance-alpha", id:date}`, `dedupKey: alphaNoticeKey(date)`.
- `attendanceAlphaPendingNotification({date, leaveId, type})` → same type and title. Body: **"Kamu tercatat Alpa pada Selasa, 18 Maret 2031 karena pengajuan sakit kamu belum disetujui. Status berubah otomatis bila disetujui."** (`izin` for IZIN). Link `{screen:"leave-request", id:leaveId}`, same dedupKey.
- `attendanceDaySummaryNotification({date, counts})` → type `ATTENDANCE_DAY_SUMMARY`, title **"Rekap kehadiran Selasa, 18 Maret 2031"**, body **"Alpa 8 · Terlambat 24 · Izin 18 · Sakit 12. 3 anomali menunggu tinjauan."** The second sentence is dropped when the count is 0. Link `{screen:"attendance-day", id:date}`, `dedupKey: daySummaryKey(date)`.
- Test the exact strings, links, dedupKeys and the IZIN/SAKIT wording. `rules.test.ts` checks that `resolveCategory` returns STUDENT_AFFAIRS for both types.

`src/lib/frontend/notification-cta.ts` (+ test):
```ts
export type NotificationCta = { kind: "link"; label: string; href: string } | { kind: "note"; text: string };
export function notificationCta(row: { type?: unknown; data?: unknown }, today: LocalDate): NotificationCta | null;
export function searchDate(search: string, key: string): LocalDate | null; // parseLocalDate (zone.ts:45)
```
- `ATTENDANCE_ALPHA` + `attendance-alpha`: if `id ≥ addDays(today,-7)`, return the link "Ajukan izin/sakit" → `/hub/my-leave?ajukan=<id>`. Otherwise return the note "Batas pengajuan izin sudah lewat (maks. 7 hari)."
- `ATTENDANCE_ALPHA` + `leave-request` → "Lihat pengajuan" → `/hub/my-leave`.
- `ATTENDANCE_DAY_SUMMARY` + `attendance-day` → "Buka kehadiran" → `/hub/attendance?tanggal=<id>`.
- Any other type, an invalid date or bad data → null.

Tests cover every branch, including the boundary at exactly today−7 (link), and `searchDate` with an invalid date, a missing key, and `2031-02-30`.

## 5. API & service flow

**Endpoints:** none new; POLICY is unchanged. Changed: the `NotificationType` enum in `GET /notifications`, `GET /notifications/{id}` (`listNotifications`, `getNotification`, action `notification.self`), and the `recloseAttendanceDay` description. Both are regenerated (`openapi:export`, `frontend:sync`). No new error codes.

**`src/lib/attendance/day-notices.ts`** (Prisma; always runs inside the closer's transaction, which already holds `lockCalendarShared`). Notification rows are written last (`tx.ts:13`).
```ts
export interface NoticeSchool { readonly id: string; readonly timezone: SchoolTz }
export async function notifyDayClosed(tx, school, date, alphaDraftIds, now): Promise<{ students: number; admins: number }>
```
1. `today = localParts(now, school.timezone).ymd`.
2. **Students**, only if `isFreshClose(date, today, 3)` and there are ids:
   - For each `chunk(sortedIds, 500)`: `tx.attendance.findMany({ where: { schoolId, date: toDbDate(date), source: "AUTO_ALPHA", studentId: { in }, student: { user: { isActive: true, lastLoginAt: { not: null } } } }, select: { studentId: true } })`. This drops drafts that INSERT IGNORE skipped because another writer got there first, and accounts that never logged in (Q3).
   - PENDING leaves covering D, using index `[schoolId,status,startDate]`. Then call `planAlphaNotices`.
   - Plain group: one `notifyStudents(tx, plain, attendanceAlphaNotification({date}), {now})`. Pending: one `notifyStudents` per student with its own leave link (few rows).
3. **Admins**, only if `isFreshClose(date, today, 1)`:
   - `tx.attendance.groupBy({ by:["status"], where:{schoolId, date}, _count:{_all:true} })`.
   - `pendingAnomalies = tx.attendance.count({ where: { schoolId, date, hasAnomaly: true, ...B1_PENDING_REVIEW_WHERE } })` (index `[schoolId,hasAnomaly,date]`). Use B1's exported predicate. Without B1, use `hasAnomaly` alone.
   - If the day is notable, call `notifySchoolAdmins(tx, schoolId, attendanceDaySummaryNotification(...), {now})`, which applies N2's mutes and primary-admin fallback.
4. `NotifyContext` has no `defer`. Student rows are PENDING and the per-tick `push-dispatch` sends them within one tick. Admin rows stay SKIPPED until N3.

**Idempotency.** Every row carries a `dedupKey` and is inserted with INSERT IGNORE on `(userId, dedupKey)`. A re-run, a stale-RUNNING takeover (the closure committed but `finish` was lost, `jobs/runner.ts:44-50`), a concurrent tick plus super-admin re-close (shared locks do not exclude each other), or a re-close after a calendar change: each yields at most one row per recipient per date. The other writer's INSERT blocks on the unique key until commit, then is ignored. Deadlocks retry via `withTx`.

**Retraction:** `retractDayNotices(tx, removed: readonly {schoolId, studentId, date, source}[]): Promise<number>`:
- For AUTO_ALPHA rows: student ids → `userId` (chunked 500), then `notification.deleteMany({ where: { type: "ATTENDANCE_ALPHA", userId: { in }, dedupKey: { in: dates.map(alphaNoticeKey) } } })`. This uses the unique index.
- For affected schools: admins (`role SCHOOL_ADMIN`) → `deleteMany` of `ATTENDANCE_DAY_SUMMARY` for `daySummaryKey(dates)`.
- It runs after the attendance-delete loop, so notifications are still last. Over-retraction stays inside the changed range and is harmless; for national holidays all schools share the same dates. Removing the holiday again re-closes the day (tick inside the lookback), and that re-sends exactly once while the date is still fresh.

**Audit.** No new action. The closure's existing audits are unchanged. `attendance.calendar_sync.after` gains `retractedNotices`.

## 6. UI changes

- **FeedView** (`domain-views.tsx`): `today = todayLocal(new Date(), me.school?.timezone)` (`monitor-rules.ts:128`) and `cta = notificationCta(row, today)`. Without a CTA the markup is unchanged. With one: `<div className="feed-card has-cta">` (same look) holds the header, title, body, and then the CTA **directly under the message**:
  - `link`: a `HubLink` with class `button primary small-button feed-cta`. Its onClick, when not in demo and `!row.readAt`, fires `api('/notifications/'+id+'/read',{method:"POST"})` best-effort and then `unreadBadge.refresh()` (N1).
  - `note`: `<p className="feed-cta-note">`.
  - The footer "Baca selengkapnya" becomes a `<button className="text-button">` that calls `onSelect`.
  - CSS in `src/styles/content.css` after :116: `.feed-cta{align-self:flex-start}`, `.feed-cta-note{font-size:.875rem;color:var(--muted)}`.
- **`?ajukan=YYYY-MM-DD`**: new hook `src/components/hub/use-url-intent.ts` `useLeaveIntent(module, available, setAction)`, used in `Workspace`. Only for `my-leave` and when `createOwnLeaveRequest` is available:
  1. `searchDate`.
  2. `history.replaceState` to strip the param.
  3. `afterPageSlide(() => setAction({ op, initial: { startDate: d, endDate: d } }))`, the same pattern as `?absen=1` (`attendance-page.tsx:38-42`).

  The server still enforces `LEAVE_BACKDATE_LIMIT` / `LEAVE_OVERLAP`.
- **`?tanggal=`** on `AttendanceMonitorPage`: an effect on mount. A valid date ≤ today sets `filter.date`, then the param is stripped. Anything else is ignored.
- **Student home**: the heading becomes "Kabar terbaru", the empty state "Belum ada kabar baru.", and the fallback title "Kabar sekolah". Pass the persona to `demoRows("/notifications", persona)`.
- **Demo**: new `src/lib/frontend/demo-notifications.ts` `demoNotificationRows(viewer, today)`, built with the real templates so the copy is identical:
  - Alya (`s1`): an `ATTENDANCE_ALPHA` for `today−1` (CTA visible).
  - Persona role SCHOOL_ADMIN: an `ATTENDANCE_DAY_SUMMARY` for `today−1` with `{8,24,18,12,3}`.
  - Both have `readAt:null`, followed by the 3 existing rows.
  - Other personas: unchanged.

  `demoRows` routes `path === "/notifications"` there with `todayLocal(new Date(),"WIB")`. `DemoViewer` gains `identity?: { user: { role: string } }`, which `DemoPersona` already satisfies. N1's `demoUnreadCount()` must count the same persona-aware rows. The CTA form in demo opens, and saving is rejected by the existing demo guard. The monitor in demo accepts any date (`demoAttendanceMap`).

## 7. Tests

**Unit:** `day-notice-rules.test.ts`, `templates/attendance-day.test.ts`, `rules.test.ts` (+2 cases), `frontend/notification-cta.test.ts`, and `frontend/demo.test.ts`. The demo test checks that Alya gets ALPHA with a working CTA; Bima, sponsor and super admin get no attendance notice; admin gets the summary; and no other student's name leaks.

**Integration:**
- **New `tests/integration/attendance/jobs/day-notices.test.ts`** (fixed 2031 dates, `jobCtx`, fixtures from `./fixtures`):
  1. Fresh close: each AUTO_ALPHA student gets exactly 1 `ATTENDANCE_ALPHA` (STUDENT_AFFAIRS, PENDING, data, dedupKey). CHECKIN/LEAVE students, inactive users and never-logged-in users get none.
  2. A PENDING leave covering D gives the pending wording plus a `leave-request` link. An APPROVED leave gives LEAVE and no notice.
  3. A second tick, `recloseSchoolDay` for D, and `closeSchoolDay`+`recloseSchoolDay` run concurrently (`Promise.all`) all leave 1 row per student and 1 summary per admin.
  4. Catch-up: school created 8 days ago, one tick closes D−7..D. ALPHA notices only for D−3..D, summaries only for D−1 and D.
  5. Summary counts are exact (CHECKIN late via `checkInRow`, approved IZIN/SAKIT, `hasAnomaly` row). Primary and extra admins get it. Inactive admins, other schools' admins and SUPER_ADMIN do not. Admin rows are SKIPPED.
  6. A day with only HADIR/IZIN gets no summary.
  7. N2: an admin who muted STUDENT_AFFAIRS gets nothing and the others get it. When all mute, the primary still gets it.
  8. B1: a reviewed anomaly is not counted.
  9. Non-school day, or a day sealed by `sealTodayForTermChange`, gets no notices.
- `calendar-sync.test.ts` gets 2 cases:
  - A holiday added after the close deletes the ALPHA rows, the notices and the summary for D (audit `retractedNotices`). CHECKIN rows and other dates are kept. Removing the holiday and running a tick re-sends exactly once.
  - A stale (> 7 days) re-close sends no notices.
- `reclose.test.ts` gets 1 case: re-closing a date 10 days old writes rows and no notifications.
- New `tests/integration/notifications/dedup.test.ts`: `notifyUsers` twice with the same dedupKey leaves 1 row; different keys leave 2; no key leaves 2 (unchanged behavior). The returned `created` counts are correct.

**Browser** (`tests/browser/frontend.spec.ts`, `pnpm test:frontend`): Alya opens Notifikasi, sees "Kamu tercatat Alpa" with "Ajukan izin/sakit", and clicking it opens the leave form with both dates prefilled. The admin persona's "Buka kehadiran" lands on the monitor with that date. `e2e/`: no change (API smoke is unaffected).

Run `pnpm test:int` in full: existing tests that close days now also create notices, but their assertions are filtered by type.

## 8. Docs to update

- **`docs/PLAN.md`**:
  - Absensi (:205-206): append "+ notifikasi Alpa ke siswa & rekap harian ke admin (N4)".
  - "Pengumuman & notifikasi" (:226-231): one sentence covering the two types, the 3-day/1-day freshness, the skip rule, the N2 mute, `dedupKey` idempotency and retraction on a retroactive holiday (owner decision 2026-10-03).
  - "Ditunda" (:261): "penggabungan notifikasi admin" becomes "penggabungan notifikasi admin per pengajuan (rekap absensi harian sudah ada, N4)".
- **`docs/backlog.md`**:
  - Row :16: add the same clarification.
  - "Tambahan": add "Rekap/peringatan per kelas untuk wali kelas" (trigger: a teacher↔class link exists) and "Jam tenang push (tick catch-up malam)" (trigger: complaints).
- **`docs/FRONTEND.md`**: notification cards may carry a CTA. Describe the URL intents `?ajukan=` and `?tanggal=`, the "Kabar terbaru" heading and the demo rows.
- **`docs/design/05-platform-crosscutting.md` §N**:
  - N1 table rows: `ATTENDANCE_ALPHA` (student, STUDENT_AFFAIRS, `attendance-alpha`/`leave-request`) and `ATTENDANCE_DAY_SUMMARY` (school admins, filtered by N2, `attendance-day`).
  - New rule after N2's N12: "**Dedup key** — `(userId, dedupKey)` unique, INSERT IGNORE, for job-generated notices".
- **`docs/design/02-attendance.md`**:
  - §3.7: a new step after the sweep for notices.
  - §3.8.6: retraction.
  - SCR list: "append `ATTENDANCE_ALPHA`, `ATTENDANCE_DAY_SUMMARY` at the end".

## 9. Edge cases & risks

- **Enum list drift between features.** B1 (earlier) or N5 (later, `20261003060000`, which copies N4's list) may also append values. Copy the list from the schema at merge time, then run `prisma validate` and the integration tests.
- **Rollback after rows exist.** Old code's Prisma client cannot parse the new enum values, so `/notifications` would fail for users who have such rows. Runbook: `DELETE FROM Notification WHERE type IN ('ATTENDANCE_ALPHA','ATTENDANCE_DAY_SUMMARY')` before rolling back the code.
- **Longer closure transaction.** It adds about 4 queries plus chunked inserts, within the 60 s timeout (`auto-alpha-job.ts:41`). INSERT IGNORE only swallows duplicates: title, body and key are length-bounded (`notify.ts:38-39`) and `userId` comes from the database.
- **Catch-up spam.** Bounded to 4 student notices and 2 summaries per outage. Night catch-up can push at night; this is accepted and goes to the backlog.
- **Onboarding schools** where many students never logged in: skipped (Q3), so there is no pile of notices on first login.
- **A leave approved later converts ALPHA to LEAVE.** The student also gets `LEAVE_APPROVED`, and the ALPHA notice stays as history. An admin correction sends `ATTENDANCE_CORRECTED`.
- **A CTA read late** (> 7 days) shows the expiry note instead of a dead button.
- **HRIS lessons** (`lib/attendanceRecalc.ts:280-345`):
  - Kept: one notice per person plus one admin summary.
  - Fixed: HRIS notifies outside the transaction, sequentially, with no dedup. Here notices are in-transaction (rollback means no notice) with a unique dedup key.
  - Fixed: HRIS sends a summary even when the change is trivial. Here non-notable days are skipped.
  - The HRIS "warning tone" becomes an explicit cause→effect line plus a CTA.

## 10. Open questions (owner-level; defaults proposed)

1. **Category.** The task asks for STUDENT_AFFAIRS, but N2's Q4 proposes a new `ATTENDANCE` ("Kehadiran") category. *Default: STUDENT_AFFAIRS*, because it needs no category migration. If the owner picks ATTENDANCE: append it to `NotificationCategory` (MODIFY on Notification, Announcement and NotificationMute), add it to `ADMIN_MUTABLE_CATEGORIES`/`CATEGORY_HINTS`, and point `CATEGORY_BY_TYPE` for both types at it.
2. **Freshness windows.** *Default:* student 3 days (covers a weekend outage and leaves ≥ 4 days to submit), admin 1 day.
3. **Students who never logged in.** *Default:* skip them.
4. **Summary when nothing is actionable** (only hadir/izin/sakit). *Default:* skip it.
5. **Register.** These notices say "kamu", as the student attendance UI does, while older student notices say "Anda". *Default:* "kamu" here; unify the rest later.
