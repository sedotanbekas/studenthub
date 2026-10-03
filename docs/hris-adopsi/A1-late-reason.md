# A1 — Alasan terlambat (late reason)

## 0. Revisi setelah kritik (2026-10-03) — berlaku di atas draf di bawah

Sumber: `A1-late-reason.critique.md`. Semua temuan diterima; yang mengubah desain:

| # Kritik | Keputusan (sudah diimplementasikan) |
|---|---|
| 1 | Kasus `chk_attendance_late_reason` ditambahkan ke `tests/integration/platform/check-cases.ts`. |
| 2 | Urutan `lateReasonBlock`: tanpa baris / bukan hari ini → `NO_RECORD`; hari ditutup → `DAY_CLOSED`; `source=ADMIN` → `LOCKED` (409, termasuk koreksi ke HADIR dan "Tidak valid" B1); bukan CHECKIN TERLAMBAT → `NOT_LATE`. |
| 3 | Panjang keterangan dihitung per code point (`lateReasonNoteLength`, sama dengan `CHAR_LENGTH`), juga untuk penghitung UI; karakter format tak terlihat (`\p{Cf}`) dibuang saat normalisasi. Pesan memakai "karakter". |
| 4 | Hitungan: `filled` = TERLAMBAT berkategori (sumber apa pun); `unfilled` = CHECKIN TERLAMBAT tanpa alasan; TERLAMBAT yang dicatat admin tanpa alasan tidak dihitung. `groupBy(["source","lateReasonCategory"])`. |
| 5 | Test bentuk persis di `check-in-service.test.ts` & `check-in-route.test.ts` diperbarui; test balapan memakai `holdLock`; penjaga katalog `scripts/frontend-catalog.test.ts`. |
| 6 | Alasan hanya bisa diisi/diubah **sebelum `dayEndMinute`** (422 `LATE_REASON_DAY_CLOSED`), selaras dengan hari final di rekap A3. `lateReasonGroups` tidak diklaim untuk A3 (A3 memakai `countLateReasons`). |
| 7 | `from` default = awal bulan dari `to` (atau hari ini). |
| 8 | Audit: `entityType Attendance`, `entityId`, `schoolId`; `before/after` hanya `{category, noteLength}` (teks bebas tidak disalin ke log permanen). Status siswa dibaca ulang di bawah kunci (403 bila tidak lagi ACTIVE). |
| 9 | Konfirmasi absen tidak menunggu alasan: `onDone` dulu, alasan dikirim dari layar "tercatat" ("Menyimpan alasan…", batas 8 detik, "Coba lagi"). |
| 10 | Copy: "Alasan tersimpan. Admin sekolah bisa membacanya."; di bawah keterangan "Dibaca admin sekolah. Tidak perlu menulis detail kesehatan."; "absen tetap terkirim" hanya di langkah tinjau. |
| 11 | Demo: "akan terlambat" dihitung dari jam lokal vs `lateAfter`; pesan simpan "Mode demo: alasan tersimpan (simulasi) — hilang saat halaman dimuat ulang." |
| 12 | UI selalu memakai `LATE_REASON_LABELS`/`lateReasonShort`, bukan `display(code)`. |
| 13 | Tag daftar memakai `.row-tag.is-neutral`; jendela deploy 03:00–20:00 UTC (lihat `00-integration.md`); catatan backlog berupa bagian `###`. |


Owner decision 2026-10-03. Branch `feat/alasan-terlambat`.

## 1. Goal & non-goals

**Goal.** When the server records a student's own check-in as TERLAMBAT, the student can give a reason.
- The reason is one of 6 categories, with an optional note. The note is required for "Lainnya".
- A reason **never** blocks or rejects a check-in. The server alone decides lateness.
- The check-in review step offers the picker when precheck predicts lateness.
- After check-in, and on the Absensi page for the rest of that local school day, the student can add or change the reason.
- Admins see the reason in the record detail, the map list and the "Data lengkap" table.
- A per-category count is exposed for A3.

**Non-goals.**
- Reasons for other statuses.
- Check-out.
- Any dialog that cannot be dismissed.
- Editing past days.
- Admins entering a reason for a student (the correction note covers this).
- Notifications (N4).
- Recap or Excel UI (A3).
- Changes to student home, student monthly history, or `scripts/lib/demo-attendance.ts`.

## 2. Existing code to reuse/change

| Path:line | Fact → change |
|---|---|
| `src/lib/attendance/precheck-service.ts:52,60`, `student-schemas.ts:193` | Precheck **already returns `wouldBeLate`**. It uses the same `computeLateness` (`check-in-rules.ts:124-127`) as check-in (`:180`). No change. |
| `src/components/hub/attendance/check-in-flow.tsx:21,103,139` | `Verdict` already holds `wouldBeLate`, and review already shows the predicted status. Changes in §6.1. |
| `student-dto.ts:11-31,54-71` | Add the 3 columns to `ATTENDANCE_ROW_SELECT`/`AttendanceRow`. `toCheckInAttendanceDto`/`toTodayRecord` take a new `today: LocalDate` and emit `lateReason` and `lateReasonEditable`. |
| `check-in-service.ts:108,157`, `student-queries.ts:64` | Pass `context.local.ymd` / `local.ymd`. The check-in write path (`presenceData` :265-282) is **not changed**. |
| `student-schemas.ts:150-152,164-175` | `todaySchema.record` and `checkInAttendanceSchema` get `lateReason: lateReasonSchema.nullable()` and `lateReasonEditable: z.boolean()`. |
| `check-in-context.ts:78-90` | Reuse `loadStudentSchool`. Ids come from the principal; there is no mobile check. |
| `correction-rules.ts:6-7,89-95`, `correction-service.ts:81-84` | A correction sets `source=ADMIN` (compare-and-set). Evidence is never touched. **No code change.** Update the description at `contracts-admin.ts:8-26`. |
| `monitor-dto.ts:68-110`; `monitor-schemas.ts:160-174,202-216,271-303`; `monitoring-queries.ts:138-150,418-453` | Brief and detail get `lateReason`. The map point gets `lateReasonCategory` (select + `toMapPoint`). `monitor-schemas.ts` also gets `lateReasonsQuery` (reusing private `rangeShape`/`classField`/`refineRange` :66-81) and `lateReasonCountsSchema`. |
| `auth/policy/attendance.ts:6` | Reuse `"attendance.self"` (STUDENT, ACTIVE). Extend its comment. |
| `http/error-status.ts:11,45,68-71` | Register `NO_ATTENDANCE_TODAY: 422`, `ATTENDANCE_NOT_LATE: 422`, `LATE_REASON_LOCKED: 409`. |
| `http/rate-limits.ts:28` | Add `LATE_REASON: {limit: 10, windowMs: 10*MINUTE_MS}`. Do **not** share `CHECK_IN`: precheck retries would throttle the reason right after check-in. |
| `platform/enum-labels.ts:8` | Add `LateReasonCategory: LATE_REASON_LABELS`. It flows into `format.ts:4` and `/meta/enums`. |
| `frontend/field-labels.ts`, `workspace-rules.ts:125-129` | Labels: `lateReason`/`lateReasonCategory` "Alasan terlambat", `lateReasonEditable` "Alasan bisa diubah", `filled` "Sudah diisi", `unfilled` "Belum diisi", `categories` "Per kategori". Add `VIEW_LABELS.monitorLateReasons = "Alasan terlambat"`. |
| `hub/data-view.tsx:15`, `attendance-admin/record-detail-dialog.tsx:45,55`, `monitor-list.tsx:64-79` | Admin display, see §6.3. |
| `frontend/demo-personas.ts:32-33`, `demo.ts:75-81`, `demo-monitor.ts:19,48-62,140-199` | Demo data, see §6.4. |
| `lib/tx.ts:7-12`, `lock-keys.ts:56`, `audit.ts:43` | Reuse the lock order, `attendanceLockKey` and `writeAudit`. |

## 3. Data model

`prisma/schema/attendance.prisma`: add the new enum. Add the fields to `Attendance` after `note` (:60).

```prisma
/// Kategori alasan terlambat (A1). Nilai baru HANYA di ujung; jangan pernah ganti nama (rekap lama harus sebanding).
enum LateReasonCategory {
  TRANSPORT
  WEATHER
  OVERSLEPT
  FAMILY
  HEALTH
  OTHER
}
  /// Alasan terlambat dari siswa: hanya baris CHECKIN TERLAMBAT, hari yang sama. Koreksi admin tidak menghapusnya.
  lateReasonCategory LateReasonCategory?
  /// Keterangan (wajib >= 5 karakter untuk OTHER), spasi dinormalkan.
  lateReasonNote     String?             @db.VarChar(200)
  /// Instant server terakhir siswa mengisi/mengubah alasan.
  lateReasonAt       DateTime?
```

`prisma/migrations/20261003010000_attendance_late_reason/migration.sql`:

```sql
-- Alasan terlambat siswa (keputusan pemilik 2026-10-03, A1). Aditif saja: tiga kolom nullable baru di
-- Attendance + satu CHECK baru; kolom & constraint lama tidak disentuh. Diisi siswa lewat
-- PUT /student/attendance/today/late-reason hanya untuk baris CHECKIN berstatus TERLAMBAT pada hari yang sama;
-- absen TIDAK PERNAH ditolak karena alasan kosong. Koreksi admin tidak menghapus alasan (tidak dihitung bila
-- status bukan TERLAMBAT). Nilai enum baru WAJIB di ujung daftar dan tidak pernah diganti nama.
-- ADD COLUMN nullable instan di MariaDB 10.11; ADD CONSTRAINT dapat menyalin ulang tabel (Attendance masih kecil).

ALTER TABLE `Attendance`
  ADD COLUMN `lateReasonCategory` ENUM('TRANSPORT', 'WEATHER', 'OVERSLEPT', 'FAMILY', 'HEALTH', 'OTHER') NULL,
  ADD COLUMN `lateReasonNote` VARCHAR(200) NULL,
  ADD COLUMN `lateReasonAt` DATETIME(3) NULL;

-- NULL pada CHECK = lolos, jadi setiap cabang ditulis eksplisit IS [NOT] NULL.
ALTER TABLE `Attendance` ADD CONSTRAINT `chk_attendance_late_reason` CHECK (
  (`lateReasonCategory` IS NULL AND `lateReasonNote` IS NULL AND `lateReasonAt` IS NULL)
  OR (`lateReasonCategory` IS NOT NULL AND `lateReasonAt` IS NOT NULL
      AND (`lateReasonCategory` <> 'OTHER' OR (`lateReasonNote` IS NOT NULL AND CHAR_LENGTH(`lateReasonNote`) >= 5)))
);
```

- No new index. Counts filter on `(schoolId, date)` through `Attendance_schoolId_date_classId_status_idx`.
- The CHECK deliberately does not tie the reason to `status`. This lets a correction keep it.

## 4. Pure rules — `src/lib/attendance/late-reason-rules.ts`

Prisma types are `import type` only, because client components import this file.

```ts
export const LATE_REASON_CATEGORIES = ["TRANSPORT","WEATHER","OVERSLEPT","FAMILY","HEALTH","OTHER"] as const satisfies readonly LateReasonCategory[];
export type LateReasonCode = (typeof LATE_REASON_CATEGORIES)[number];
export const LATE_REASON_LABELS: Readonly<Record<LateReasonCode, string>> = { TRANSPORT: "Transportasi / macet", WEATHER: "Hujan / cuaca",
  OVERSLEPT: "Bangun kesiangan", FAMILY: "Keperluan keluarga", HEALTH: "Kurang sehat", OTHER: "Lainnya" };
export const LATE_REASON_NOTE_MAX = 200, LATE_REASON_OTHER_NOTE_MIN = 5, LATE_REASON_NOTE_RAW_MAX = 400;
export function normalizeLateReasonNote(raw: string | null | undefined): string | null; // control chars->space, collapse, trim, ""->null
export function lateReasonNoteProblem(category: LateReasonCode, note: string | null): string | null;
export interface LateReasonTarget { readonly status: AttendanceStatus; readonly source: AttendanceSource; readonly date: LocalDate }
export type LateReasonBlock = "NO_RECORD" | "NOT_LATE" | "LOCKED";
export function lateReasonBlock(row: LateReasonTarget | null, today: LocalDate): LateReasonBlock | null;
//  null/date!==today -> NO_RECORD; status!==TERLAMBAT -> NOT_LATE; source!==CHECKIN -> LOCKED; else null
export const canEditLateReason = (row: LateReasonTarget | null, today: LocalDate) => lateReasonBlock(row, today) === null;
export interface LateReasonValue { readonly category: LateReasonCode; readonly note: string | null }
export function isSameLateReason(stored: LateReasonValue | null, next: LateReasonValue): boolean;
export interface LateReasonColumns { lateReasonCategory: LateReasonCode | null; lateReasonNote: string | null; lateReasonAt: Date | null }
export interface LateReasonDto { category: LateReasonCode; note: string | null; timeLocal: string; updatedAt: string }
export function toLateReasonDto(row: LateReasonColumns, tz: SchoolTz): LateReasonDto | null;
export function lateReasonSavedMessage(unchanged: boolean): string; // "Alasan tersimpan, wali kelas bisa membacanya." | "Alasan ini sudah tersimpan."
export function countLateReasons(groups: ReadonlyArray<{ category: LateReasonCode | null; count: number }>):
  { total: number; filled: number; unfilled: number; categories: Array<{ category: LateReasonCode; count: number }> }; // zero-filled, canonical order
// UI helpers
export interface LateReasonDraft { readonly category: LateReasonCode | null; readonly note: string }
export function lateReasonDraftState(d: LateReasonDraft): "EMPTY" | "READY" | "INCOMPLETE";
export function lateReasonBodyOf(d: LateReasonDraft): LateReasonValue | null; // null unless READY
export function lateReasonNextStep(att: { status: string; lateReason: LateReasonDto | null; lateReasonEditable: boolean }, d: LateReasonDraft):
  "NONE" | "SHOW_SAVED" | "AUTO_SUBMIT" | "ASK"; // !TERLAMBAT->NONE; stored->SHOW_SAVED; !editable->NONE; READY->AUTO_SUBMIT; else ASK
export function lateReasonAdminView(r: { status: string; source: string; lateReason: LateReasonDto | null }): { title: string; text: string } | null;
export function lateReasonShort(r: { category: LateReasonCode } | null): string;
```

Validation messages:
- `"Tulis alasannya minimal 5 huruf."` when the category is OTHER and the note is missing or shorter than 5 characters.
- `"Keterangan maksimal 200 karakter."` when the note is over 200 characters.

**`late-reason-rules.test.ts` — write these first.**
- The category array matches the exact 6 codes (guards append-only).
- Note normalization:
  - newlines and control chars collapse to one space;
  - whitespace only → `null`.
- `lateReasonNoteProblem`:
  - OTHER with null → problem; with 4 chars → problem; with 5 chars → `null`;
  - TRANSPORT with null → `null`;
  - 201 chars → problem for any category.
- `lateReasonBlock`:
  - null row → NO_RECORD;
  - yesterday TERLAMBAT/CHECKIN → NO_RECORD;
  - HADIR/CHECKIN, IZIN/LEAVE, HADIR/ADMIN → NOT_LATE;
  - TERLAMBAT/ADMIN → LOCKED;
  - TERLAMBAT/CHECKIN today → `null`.
- `isSameLateReason`: true and false cases, plus a null stored value.
- `toLateReasonDto`:
  - a null category → `null`;
  - `timeLocal` is correct in WIB and WIT.
- `countLateReasons`:
  - zero-fills missing categories;
  - a null group counts as `unfilled`;
  - `total = filled + unfilled`.
- One case per branch for: draft state, `lateReasonNextStep`, and `lateReasonAdminView` (titles "Alasan terlambat" / "Alasan terlambat (sebelum dikoreksi)" / "Belum diisi siswa." / `null` for ADMIN TERLAMBAT without reason).

## 5. API

`src/lib/attendance/late-reason-schemas.ts`:
- `lateReasonSchema` (meta id `AttendanceLateReason`): `{category, note|null, timeLocal, updatedAt}`.
- `lateReasonBody` (`AttendanceLateReasonInput`): `z.strictObject({ category: z.enum(LATE_REASON_CATEGORIES, "Pilih salah satu alasan."), note: z.string().max(400).nullable().optional().transform(normalizeLateReasonNote) })` plus a `superRefine` that runs `lateReasonNoteProblem` and reports on path `note`.
- `lateReasonResultSchema` (`AttendanceLateReasonResult`): `{ lateReason, unchanged, message }`.

### 5.1 `PUT /api/v1/student/attendance/today/late-reason`

| Item | Value |
|---|---|
| Contract | id `setOwnLateReason`, in `contracts-student.ts` |
| Action | `attendance.self` (STUDENT, ACTIVE) |
| Rate limit | `{limiter: "LATE_REASON", key: "user"}` |
| Route file | `src/app/api/v1/student/attendance/today/late-reason/route.ts` (`defineRoute`) |
| Errors | 400 VALIDATION_FAILED, 403 STUDENT_NOT_ACTIVE, 422 NO_ATTENDANCE_TODAY / ATTENDANCE_NOT_LATE, 409 LATE_REASON_LOCKED / CONFLICT_RETRY, 429 |
| Session | No mobile-only requirement: the reason is not location evidence |

Service `late-reason-service.ts`, `setOwnLateReason(body, ctx)`:
1. Call `loadStudentSchool(ctx)`.
2. If the student is not ACTIVE, return 403 STUDENT_NOT_ACTIVE.
3. Set `today = localParts(ctx.now, tz).ymd`.
4. Run `withTx` with lock order **AppLock → Attendance → AuditLog**:
   - a. `lockKey(tx, attendanceLockKey(student.id))` first. This is the same mutex as check-in and correction.
   - b. `findFirst({ where: { studentId, schoolId, date: toDbDate(today) } })`.
   - c. Apply `lateReasonBlock`:
     - NO_RECORD → 422 NO_ATTENDANCE_TODAY "Belum ada absensi hari ini, jadi belum ada alasan yang perlu diisi."
     - NOT_LATE → 422 ATTENDANCE_NOT_LATE "Absensi hari ini tidak tercatat terlambat, jadi alasan tidak diperlukan."
     - LOCKED → 409 LATE_REASON_LOCKED "Absensi hari ini sudah dicatat ulang sekolah, jadi alasan tidak bisa diubah lagi."
   - d. If `isSameLateReason`, return `unchanged=true`. No write, no audit.
   - e. `updateMany({ where: { id, schoolId, status: "TERLAMBAT", source: "CHECKIN" }, data: {…, lateReasonAt: ctx.now} })`. If `count !== 1`, return 409 CONFLICT_RETRY.
   - f. `writeAudit` last:
     - action `attendance.late_reason`;
     - before `{category, note} | null`;
     - after `{category, note, date}`.

     The detail `audit` list (`monitoring-queries.ts:331-336`) shows this automatically.
5. No notification.

### 5.2 `GET /api/v1/school/attendance/late-reasons`

| Item | Value |
|---|---|
| Contract | id `monitorLateReasons`, in `contracts-monitor.ts` |
| Action | `attendance.monitor` (ADMINS) |
| Route file | `src/app/api/v1/school/attendance/late-reasons/route.ts` |
| Query | `lateReasonsQuery = monitorScopeQuery.extend({ ...rangeShape, classId: classField }).superRefine(refineRange)` |
| Response | `MonitorLateReasonCounts` `{ from, to, total, filled, unfilled, categories: [{category, count}] }` |
| Errors | SCHOOL_NOT_FOUND, CLASS_NOT_FOUND, SCHOOL_ID_REQUIRED, VALIDATION_FAILED |

`late-reason-queries.ts`:
- `lateReasonGroups(schoolId, range, classId?)` runs a `groupBy(["lateReasonCategory"])` where `status: "TERLAMBAT"`, `date` in range, and `classId` if given. Export it for A3.
- `getLateReasonCounts(ctx, query)`:
  1. Resolve scope and school with `monitorScope`, `loadMonitorSchool` and `schoolToday` (`monitoring-queries.ts:61,66,88`).
  2. Resolve the range with `resolveRange(query.from ?? monthRange(today.slice(0,7))!.from, query.to, today, 31)`. If it returns null → 400, the same as `:350`.
  3. Check the class with `assertClassInSchool` (:108).
  4. Build the result with `countLateReasons`.

### 5.3 Additive response changes

- Today `record` and check-in `attendance` get `lateReason` and `lateReasonEditable`.
- `MonitorAttendanceBrief` and `MonitorAttendanceDetail` get `lateReason`. It is sent whenever stored; the UI labels it.
- Map points get `lateReasonCategory`.
- Afterwards run `pnpm openapi:export` and `pnpm frontend:sync`.

## 6. UI

New file `src/components/hub/attendance/late-reason-form.tsx`:
- `LateReasonPicker`:
  - a `role="radiogroup"` with 6 chips;
  - a textarea (max 200, counter `n/200`). Label "Tulis singkat alasannya" for OTHER, else "Keterangan tambahan (opsional)";
  - when INCOMPLETE, the hint "Tulis minimal 5 huruf — atau lewati, absen tetap terkirim."
- `LateReasonForm`:
  - "Simpan alasan" (enabled only when READY) and "Nanti saja";
  - errors appear inline next to the buttons;
  - saves through `api(…, {method: "PUT"})`, or `demoSaveLateReason` in demo mode.
- `LateReasonPanel`:
  - without a reason: "Alasan terlambat belum diisi." with **[Isi alasan]** next to it;
  - with a reason: "Alasan: {label} — {note}", plus **[Ubah]** when editable;
  - the form opens inline, never as a modal.
- CSS goes in `src/styles/student.css`.

**6.1 `check-in-flow.tsx`**
- Lift `reasonDraft` state into `CheckInFlow` so it survives a location or photo retry.
- `ReviewStep` (:112-143): when `verdict?.wouldBeLate`, show "Kenapa terlambat?" with "Opsional · bisa diisi nanti hari ini." and the picker. "Kirim absensi" is **never** disabled because of the reason.
- After the check-in succeeds, `send()` checks for `AUTO_SUBMIT` and then PUTs the reason in its **own** try/catch:
  - a reason failure never reaches `onLocationError`/`onImageError`;
  - it never undoes the check-in.
- `DoneStep` (:155-164):
  - SHOW_SAVED → "Alasan: {label} · tersimpan."
  - ASK → inline form, prefilled from the draft.
  - On error → "Alasan belum tersimpan: {message}" next to **[Coba lagi]**.
  - "Selesai" is always enabled.

**6.2 `attendance-page.tsx:53-60`**
- `TodayCard` renders `LateReasonPanel` when the record is TERLAMBAT and (`lateReason` or `lateReasonEditable`).
- After a save, show the server `message` and bump `version`.
- In demo mode, use a local override instead, because a reload resets demo data.

**6.3 Admin**
- The detail dialog shows a block after the status line, built by `lateReasonAdminView`: "{label} "{note}" · diisi pukul {timeLocal}".
- `PointRow` shows the tag `Alasan: {label}` for TERLAMBAT points. Add a neutral `.row-tag` in `monitor.css`.
- The table cell shows `07:31 · Hujan / cuaca`.
- "Data lengkap" gains the generic tab "Alasan terlambat".

**6.4 Demo** (no network calls)
- Citra persona: `lateReason: null, lateReasonEditable: true`. Bima: `lateReasonEditable: false`.
- `demo.ts` gains `demoSaveLateReason(body, now)` with the message "Mode demo: alasan tidak disimpan."
- `demo-monitor.ts` gains a `LATE_REASONS` map:

  | Student | Category | Note |
  |---|---|---|
  | d16 | TRANSPORT | — |
  | d29 | WEATHER | "Hujan deras, menunggu reda di halte." |
  | d18 | OVERSLEPT | — |
  | d23 | FAMILY | "Mengantar adik ke SD dulu." |
  | d20 | OTHER | "Ban sepeda bocor di jalan." |
  | s3 (Citra) | unfilled | — |

  The reason is stamped at check-in + 2 min. It feeds the map points, daily rows (:146) and `detailBase`.
- Add the exact path `"/school/attendance/late-reasons"` → `demoLateReasonCounts()` in `demoMonitorRows`. It must match before the loose `includes("attendance")` fallback in `demo.ts:64`.

## 7. Tests

**Unit**
- `late-reason-rules.test.ts` covers §4.
- `late-reason-schemas.test.ts`:
  - accept a valid body and normalize the note;
  - OTHER without a note → issue on `note`;
  - unknown category or extra key → reject.
- Extend these existing tests:

  | Test file | Case |
  |---|---|
  | `student-dto.test.ts` | `lateReasonEditable` is false for yesterday |
  | `monitor-dto.test.ts` | — |
  | `demo-monitor.test.ts` | reasons consistent across views; counts 6 / 5 / 1 |
  | `demo-personas.test.ts` | — |
  | `rate-limits.test.ts` | — |
  | `workspace-rules.test.ts` | — |

- `field-labels.test.ts` and `error-status.test.ts` must stay green.

**Integration: `tests/integration/attendance/checkin/late-reason.test.ts`** (`createWorld`, `checkInBodyAt`, `localInstant`, `callRoute`)
1. A late check-in without a reason returns 201 with `lateReason` null and editable true.
2. PUT TRANSPORT:
   - sets the columns and `lateReasonAt = now`;
   - writes one audit with before null;
   - the today endpoint shows the reason.
3. Repeat the same PUT → unchanged, no audit. PUT OTHER with a note → audit with before and after.
4. Return 422 NO_ATTENDANCE_TODAY for:
   - a HADIR row (expect 422 ATTENDANCE_NOT_LATE here, not NO_ATTENDANCE_TODAY);
   - no row today;
   - only yesterday's unfilled late row exists.
5. After an admin correction to HADIR, the student PUT → 409 LATE_REASON_LOCKED. The columns are kept.
6. Route: OTHER without a note → 400. Unauthenticated → 401.
7. A principal without a deviceId → 200.
8. Race: hold the correction tx (`holdTx`/`raceWhileHeld`) → the PUT ends LOCKED, no lost update.
9. A raw update with OTHER and a null note is rejected by `chk_attendance_late_reason`.

**Integration: `tests/integration/attendance/monitor/late-reasons.test.ts`** (`monitor/fixtures.ts`)
- The daily list, map and detail carry the reason.
- Counts:
  - zero-filled categories;
  - correct filled/unfilled;
  - from/to and class filters work;
  - a row corrected to HADIR is excluded;
  - a class from another tenant → 404;
  - super admin without schoolId → 400 SCHOOL_ID_REQUIRED;
  - more than 92 days → 400.

**E2E (`e2e/smoke.spec.ts`, CI)**
- `/meta/enums` includes `LateReasonCategory` with 6 labels.
- The PUT without login → 401.

**Browser (`tests/browser`, local `pnpm test:frontend`)**
- Demo Citra: "Isi alasan" → "Hujan / cuaca" → save → card shows "Alasan: Hujan / cuaca". "Nanti saja" closes the form.
- The monitor detail for d16 shows "Transportasi / macet".

## 8. Docs to update

| File | Change |
|---|---|
| `docs/PLAN.md:199-202` | New bullet **Alasan terlambat (pemilik 2026-10-03, A1)**: optional category + note; today only, own CHECKIN TERLAMBAT; never blocks a check-in; the server decides; a correction keeps the reason but it is no longer counted; visible in admin views + `GET /school/attendance/late-reasons`; no notification. The "Ditunda" list (:259-265) is unchanged by A1. |
| `docs/backlog.md` | New row "Alasan terlambat hari lampau / diisi wali kelas atas nama siswa — siswa hanya hari yang sama; admin memakai catatan koreksi — bila wali kelas meminta". |
| `docs/FRONTEND.md` | :11 the Citra persona demonstrates filling a reason; :70-81 bullet "Alasan terlambat" (picker in review, Done step, card CTA, never a modal); :97-98 list the new files. |
| `docs/design/02-attendance.md` | §2 (:35) the endpoints; new §3.11 rules/lock order; §3.9 (:319) the correction keeps the reason and locks student edits; §6 (:563) the schema delta. |
| `docs/integration/expo.md` | §5 (:135-157) optional reason after a late check-in; §14 (:325) the `LATE_REASON` limit; §15 (:333) QA item. |

## 9. Edge cases & risks

| Case | Handling |
|---|---|
| Precheck predicted on time, check-in recorded late (crossed `lateAfter`) | DoneStep ASK. The today card CTA stays available for the rest of the day. |
| Draft chosen, check-in recorded HADIR | `NONE`: the draft is dropped. |
| Replay 200 | Auto-submit only if nothing is stored. A replay never overwrites a stored reason. |
| PUT fails after check-in | The check-in stands. The user gets an inline retry, then the card CTA. The admin sees "Belum diisi siswa." |
| Any admin correction | LOCKED. The columns are kept (student statement = evidence, like the selfie). Counts filter TERLAMBAT. The detail shows "(sebelum dikoreksi)". |
| LEAVE→CHECKIN conversion that is late; test-mode late check-in | Treated as a normal CHECKIN TERLAMBAT. |
| Midnight | The server's local `today` decides. Yesterday's row is unreachable. |
| Concurrent check-in / correction / PUT | One `attendance:<studentId>` AppLock plus compare-and-set. |
| Free text from minors (may be health related) | Shown only to the school's admins and the student. No notification. React renders it as text. Control chars are stripped. `zod.max` counts UTF-16 units, which is stricter than the DB limit. |
| Old clients | Every change is additive and the PUT is optional. |
| Migration on live production | The CHECK may copy the table. It is still small (go-live 2026-09-21). Deploy outside the 06:00–10:00 local check-in window. |
| A2 also edits `check-in-flow.tsx:39-77` | A1 only touches the draft state, ReviewStep and DoneStep. Whichever lands second rebases. |

**HRIS lessons applied**
- **8ccd109 / 4c1a9cc.** In HRIS, a dialog that could not be closed, driven by a stored demand flag, trapped on-time staff after recalculations and garbage values. Here:
  - nothing is modal or mandatory;
  - "needs a reason" is **derived from the row** (status/source/date), never stored, so a correction clears it automatically;
  - an ENUM plus CHECK makes garbage unstorable;
  - the client renders nothing for unknown codes.
- **96743f5.** Codes are frozen (append-only, never renamed). Lateness is fixed by the server at check-in.
- **`alasan-terlambat/route.ts`.**
  - Kept: own record only, today only, kind derived from the row not the body, note optional except "Lainnya", every change audited, no notification flood to supervisors.
  - Changed: edits are allowed on the same day, because the owner asked for add/update.

## 10. Open questions (owner)

1. **Can a student change a saved reason the same day?** Default: yes, with every change audited. HRIS locks the reason after the first save.
2. **Can a wali kelas fill in a reason for a student, or for past days?** Default: no; it goes to the backlog.
3. **Should anyone be notified about lateness or reasons?** Default: no notifications; revisit in N4.
4. **Category wording.** Default: the 6 labels in §4. Labels can change later; codes cannot.
