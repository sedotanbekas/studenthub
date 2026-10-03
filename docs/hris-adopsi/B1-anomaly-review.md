# B1 — Tinjau anomali (anomaly review)

## 0. Revisi setelah kritik (2026-10-03) — berlaku di atas draf di bawah

Sumber: `B1-anomaly-review.critique.md`. Semua temuan diterima; yang mengubah desain:

| # Kritik | Keputusan (sudah diimplementasikan) |
|---|---|
| 1 | Label respons baru di `field-labels.ts`: `decision`, `statusChanged`, `needsReview`, `reviewDecision`, `review`, `reviewer`, `anomaly`, `any`, `unreviewed`, `UNREVIEWED`, `ALL_ANOMALIES`. VALID/INVALID lewat `ENUM_LABELS.AnomalyReviewDecision`. |
| 2 | Test integrasi `tests/integration/attendance/monitor/anomaly-review.test.ts`: NOT_SCHOOL_DAY diuji lewat libur sekolah + tanggal di luar semester (bukan hari Minggu); kasus CHECK memakai `anomalyReviewedById: fx.admin.id`; akses mencakup 403 `SCOPE_MISMATCH`. `checkInRow` mendapat opsi `hasAnomaly`. |
| 3 | Body memuat `flags` (kode yang dilihat admin); `sameFlagSet` berbeda → 409 `ANOMALY_FLAGS_CHANGED` "Catatan pemeriksaan berubah sejak dibuka. Periksa lagi, lalu putuskan." tanpa menulis (juga di demo). Bukan `updatedAt`. Test: flag masuk selagi tinjauan menunggu kunci baris → 409. |
| 4 | `RecordHost`: Koreksi diisi dari detail yang dimuat (`detail.student.id`, `detail.date`), bukan filter halaman. |
| 5 | Tidak ada "batalkan Tidak valid". Tombol Koreksi hanya bila status masih ALPHA; setelah dipulihkan tag "Tidak valid · dipulihkan". Status yang berwenang (A3/N4 menghitung status, bukan keputusan). Backlog: "Tidak valid → Valid / pulihkan status otomatis". |
| 6 | Pernyataan pembuka ulang di sapuan memakai predikat yang sama dengan penandaan (`NULL` / bukan array ikut), dijalankan sebagai pernyataan terpisah **sebelum** penandaan. Test di `auto-alpha.test.ts` & `check-in-service.test.ts`. |
| 7 | `UNREVIEWED_DEFAULT_RANGE_DAYS = CORRECTION_WINDOW_DAYS + 1` (hari ini + 45 hari ke belakang), diikat ke `validateCorrection` lewat unit test; integrasi: today−45 masuk, today−46 tidak. |
| 8 | Label filter berbahasa Indonesia; filter "semua" bernama `ALL_ANOMALIES` (menghindari bentrok label `ALL`). Deskripsi kontrak daily/anomalies/detail diperbarui; `openapi:export` + `frontend:sync`. |
| 9 | `reviewViolationStatus` (409 untuk `ANOMALY_ALREADY_INVALID`/`ANOMALY_FLAGS_CHANGED`, selain itu 422) + unit test; baca ulang null → 404; rencana `create` → `Error`. Kontrak `errors` lengkap termasuk `CONFLICT_RETRY`. |
| 10 | Nama tunggal `PENDING_ANOMALY_REVIEW_WHERE` di `anomaly-review-rules.ts` (`import type` Prisma saja agar aman di klien). Kalimat N3/N4 diperbaiki saat revisi spesifikasinya. |
| 11 | Pesan catatan per keputusan (VALID "Catatan minimal 5 karakter, atau kosongkan."; INVALID "Tulis alasan minimal 5 karakter — alasan ini dikirim ke siswa."); jendela 45 hari dicek di muka (`invalidBlockedByWindow`) dengan penjelasan di tempat tombol; waktu tinjauan "3 Okt 2026 08.05" di zona sekolah; tanpa aksi generik untuk operasi ini (dialog catatan kustom). Galat yang memuat ulang detail dibawa lewat toast. |
| 12 | Demo: `demoRows` menerima parameter tampilan; filter Valid/Tidak valid/Semua bekerja; tinjauan sesi disimpan di memori halaman (dicatat di FRONTEND.md sebagai pengecualian). |
| 13 | Tag "Tidak valid" memakai `.row-tag.is-neutral` milik A1; tanpa "bersama A1" — merge per fitur, jendela 03:00–20:00 UTC (lihat `00-integration.md`); rujukan HRIS hanya latar (repo luar). |

Jawaban default pertanyaan §10 dipakai: (1) tidak ada pemulihan otomatis; (2) semua akun admin sekolah boleh;
(3) alasan dikutip apa adanya ke siswa; (4) tandai valid massal ke backlog.


Owner approved 2026-10-03. Migration `20261003020000_attendance_anomaly_review` runs after A1's `20261003010000`. N4 imports `PENDING_ANOMALY_REVIEW_WHERE` from here.

## 1. Goal & non-goals

**Goal.** An admin opens a record with `hasAnomaly=true` and marks it **Valid** or **Tidak valid**. "Admin" means SCHOOL_ADMIN, including extra teacher accounts, or SUPER_ADMIN with `?schoolId=`.
- **Valid:** the attendance stands.
- **Tidak valid:** the record goes through the same path as an admin correction to ALPHA. Source becomes ADMIN and note = reason. School admins get the 45-day window. The evidence is kept. It is audited and the student gets `ATTENDANCE_CORRECTED`.

The "Perlu ditinjau" queue and every "perlu ditinjau" count show **unreviewed** records only. A filter shows reviewed ones. A VALID review reopens automatically when a new flag appears later.

**Non-goals.**
- No per-flag triage, no bulk review, no new page.
- No automatic status restore when INVALID is undone. Restoring is done with Koreksi.
- Students never see flags or VALID decisions.
- No change to flag detection.
- No admin notifications (N4 owns them).

## 2. Existing code to reuse/change

| path:line | Change |
|---|---|
| `prisma/schema/attendance.prisma:31-77` | Add 4 columns, a relation and an index (§3). The `:73` index is kept. |
| `prisma/schema/auth.prisma:67-75` | Add User back-relation. |
| `src/lib/attendance/correction-rules.ts:11-13,45-59,89-95` | Reuse `CORRECTION_*`, `validateCorrection`, `buildCorrectionPatch` unchanged. |
| `src/lib/attendance/correction-service.ts:59-70` | **Export** `assertCorrectableDate`. Its param becomes `{scope; date; windowLimited}`; `CorrectionRequest` still fits. |
| `src/lib/attendance/correction-service.ts:111-127`; `src/lib/tx.ts:7-13,113`; `src/lib/lock-keys.ts:56`; `src/lib/students/records.ts:94` | Lock and write pattern to copy. |
| `src/lib/notifications/templates/attendance-admin.ts:47-54` | `attendanceCorrectedNotification`, reused. |
| `src/lib/auth/policy/attendance.ts:12-15` | Add `"attendance.anomaly_review": { roles: ADMINS }`. |
| `src/lib/attendance/contracts-admin.ts:84-86`, `admin-schemas.ts` | New contract and schemas (§5). |
| `src/lib/attendance/monitor-schemas.ts:53,79-81,160-182,202-216,271-303` | Query filters and review fields. |
| `src/lib/attendance/monitor-dto.ts:68-110`; `monitoring-queries.ts:47,138-150,194-208,235-251,345-373,418-452` | DTO mapping, selects, filters, default range. |
| `src/lib/attendance/sweep.ts:18-41`; `check-in-service.ts:304-326` | Reopen VALID reviews (§5.3). |
| `src/lib/http/error-status.ts` | Add `NO_ANOMALY: 422`, `ANOMALY_ALREADY_INVALID: 409`. |
| `src/lib/platform/enum-labels.ts:8-9` | Add `AnomalyReviewDecision: { VALID: "Valid", INVALID: "Tidak valid" }`. |

## 3. Data model

```prisma
/// Keputusan tinjau anomali (pemilik 2026-10-03). INVALID = dikoreksi menjadi ALPHA.
enum AnomalyReviewDecision {
  VALID
  INVALID
}
// model Attendance — after `note`:
  /// NULL = belum ditinjau. decision/reviewedAt/reviewedById diisi bersama (chk_attendance_anomaly_review).
  /// Dikosongkan lagi bila flag BARU muncul pada catatan VALID.
  anomalyReviewDecision AnomalyReviewDecision?
  anomalyReviewedAt     DateTime?
  anomalyReviewedById   String?
  /// Wajib untuk INVALID (disalin juga ke `note` & alasan notifikasi siswa).
  anomalyReviewNote     String?   @db.VarChar(255)
  anomalyReviewedBy User? @relation("AttendanceAnomalyReviewer", fields: [anomalyReviewedById], references: [id], onDelete: Restrict, onUpdate: Restrict)
  @@index([schoolId, hasAnomaly, anomalyReviewedAt, date])
// model User:
  attendanceAnomalyReviews Attendance[] @relation("AttendanceAnomalyReviewer")
```

`prisma/migrations/20261003020000_attendance_anomaly_review/migration.sql`:

```sql
-- Tinjau anomali absensi (keputusan pemilik 2026-10-03, B1): admin menandai catatan beranomali Valid / Tidak valid.
-- Aditif saja: enum baru + 4 kolom nullable + 1 indeks + 1 FK + 1 CHECK di Attendance; tidak ada kolom/indeks lama
-- yang diubah atau dihapus. Satu ALTER agar tabel hanya dibangun ulang sekali (FK & CHECK memaksa ALGORITHM=COPY
-- di MariaDB 10.11) — deploy di luar jam absen 06.00–10.00 lokal. Baris lama: semua NULL = belum ditinjau.
-- Tidak valid = koreksi menjadi ALPHA (sumber ADMIN) dalam transaksi yang sama; flag anomali tidak pernah dihapus.
ALTER TABLE `Attendance`
  ADD COLUMN `anomalyReviewDecision` ENUM('VALID', 'INVALID') NULL,
  ADD COLUMN `anomalyReviewedAt` DATETIME(3) NULL,
  ADD COLUMN `anomalyReviewedById` VARCHAR(191) NULL,
  ADD COLUMN `anomalyReviewNote` VARCHAR(255) NULL,
  ADD INDEX `Attendance_schoolId_hasAnomaly_anomalyReviewedAt_date_idx`(`schoolId`, `hasAnomaly`, `anomalyReviewedAt`, `date`),
  ADD CONSTRAINT `Attendance_anomalyReviewedById_fkey` FOREIGN KEY (`anomalyReviewedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `chk_attendance_anomaly_review` CHECK (
    (`anomalyReviewDecision` IS NULL AND `anomalyReviewedAt` IS NULL AND `anomalyReviewedById` IS NULL AND `anomalyReviewNote` IS NULL)
    OR (`anomalyReviewDecision` IS NOT NULL AND `anomalyReviewedAt` IS NOT NULL AND `anomalyReviewedById` IS NOT NULL
        AND `hasAnomaly` = 1 AND (`anomalyReviewDecision` <=> 'VALID' OR `anomalyReviewNote` IS NOT NULL))
  );
```

There is no explicit FK index. InnoDB creates it, the same as `LeaveRequest_reviewedById_fkey` at init `:796`. Check for drift with `prisma migrate diff` against a migrated DB.

## 4. Pure rules — `src/lib/attendance/anomaly-review-rules.ts` (+ `.test.ts` first)

```ts
export const ANOMALY_REVIEW_DECISIONS = ["VALID", "INVALID"] as const satisfies readonly AnomalyReviewDecision[];
export type ReviewDecision = (typeof ANOMALY_REVIEW_DECISIONS)[number];
export const ANOMALY_REVIEW_FILTERS = ["UNREVIEWED", "VALID", "INVALID", "ALL"] as const;
export type AnomalyReviewFilter = (typeof ANOMALY_REVIEW_FILTERS)[number];
export const REVIEW_NOTE_MIN = CORRECTION_REASON_MIN; export const REVIEW_NOTE_MAX = CORRECTION_REASON_MAX;
export const UNREVIEWED_DEFAULT_RANGE_DAYS = CORRECTION_WINDOW_DAYS; // 45: beyond it a school admin cannot INVALID
export const REVIEWED_DEFAULT_RANGE_DAYS = 7;                       // current DEFAULT_ANOMALY_RANGE_DAYS
export function needsAnomalyReview(row: { readonly hasAnomaly: boolean; readonly anomalyReviewedAt: Date | null }): boolean;
export function normalizeReviewNote(note: string | null | undefined): string | null; // trim, "" -> null
export function reviewNoteProblem(decision: ReviewDecision, note: string | null | undefined): string | null;
export type ReviewPlan = { kind: "unchanged" } | { kind: "mark" } | { kind: "invalidate" } | { kind: "violation"; violation: RuleViolation };
export function planAnomalyReview(state: { readonly hasAnomaly: boolean; readonly decision: ReviewDecision | null }, decision: ReviewDecision): ReviewPlan;
export function reopensOnNewFlag(decision: ReviewDecision | null): boolean; // VALID only
export function anomalyQueueDefaultDays(filter: AnomalyReviewFilter): number;
```

Test cases:

1. **`needsAnomalyReview`**
   - (true, null) → true
   - (true, date) → false
   - (false, null) → false
2. **`normalizeReviewNote`**
   - `"  "` → null
   - `" Foto "` → `"Foto"`
3. **`reviewNoteProblem`**
   - INVALID with a null note → "Alasan wajib diisi bila tidak valid (min. 5 karakter)."
   - INVALID with `"abcd"` → the min message
   - INVALID with 256 characters → the max message
   - VALID with null or `"  "` → null
   - VALID with `"ok"` → the min message
4. **`planAnomalyReview`**
   - `hasAnomaly=false` → `NO_ANOMALY`. This check runs first.
   - null + VALID → mark
   - null + INVALID → invalidate
   - VALID + VALID → unchanged
   - VALID + INVALID → invalidate
   - INVALID + INVALID → unchanged
   - INVALID + VALID → `ANOMALY_ALREADY_INVALID`
5. **`reopensOnNewFlag`**
   - VALID → true
   - INVALID → false
   - null → false
6. **`anomalyQueueDefaultDays`**
   - UNREVIEWED → 45
   - any other filter → 7

Violation messages:
- `NO_ANOMALY`: "Catatan ini tidak punya anomali yang perlu ditinjau."
- `ANOMALY_ALREADY_INVALID`: "Catatan ini sudah ditandai tidak valid. Untuk memulihkan status, pakai Koreksi absensi."

## 5. API

### 5.1 `POST /api/v1/school/attendance/{id}/anomaly-review`

**Contract and route.**
- Contract `reviewAnomalyContract`, id `reviewAttendanceAnomaly`, tag "Absensi (Admin)".
- Action `attendance.anomaly_review`, open to SUPER_ADMIN and SCHOOL_ADMIN.
- Route file `src/app/api/v1/school/attendance/[id]/anomaly-review/route.ts` uses `defineRoute`. It returns `{ data: await reviewAnomaly(ctx, query.schoolId, params.id, body) }`.
- Params are `{ id: entityIdSchema }`. Query is `schoolIdQuery`.

**Body** (`AttendanceAnomalyReviewInput`):
- `z.strictObject({ decision: z.enum(ANOMALY_REVIEW_DECISIONS), note: z.string().trim().max(255).nullable().optional() })`.
- A `superRefine` calls `reviewNoteProblem`. Failure → 400 `VALIDATION_FAILED` at path `note`.

**Response** `{ attendance, unchanged, statusChanged }`:
- `attendance` = `correctedAttendanceSchema.extend({ needsReview: z.boolean(), review: anomalyReviewSchema.nullable() })`.
- `anomalyReviewSchema` (`AttendanceAnomalyReview`, in monitor-schemas) = `{ decision, note: string|null, reviewedAt: date-time, reviewer: {id, name} }`.

**Errors.**
- 404 `NOT_FOUND`: missing record, or a record from another tenant.
- 422 `NO_ANOMALY`.
- 409 `ANOMALY_ALREADY_INVALID`.
- 422 `NOT_SCHOOL_DAY` and `CORRECTION_WINDOW_EXPIRED`: INVALID only. The window applies to SCHOOL_ADMIN only.
- 400 `SCHOOL_ID_REQUIRED`: SUPER_ADMIN without `schoolId`.

The contract description (in Indonesian) states the VALID and INVALID effects, the window, "INVALID tidak bisa dikembalikan ke VALID — pakai Koreksi", and that the same decision returns `unchanged`.

**Service `src/lib/attendance/anomaly-review-service.ts`** (functions < 50 lines):
1. **`reviewAnomaly`**
   - `requirePrincipal` → `resolveSchoolScope`.
   - Pre-read `findFirst({ where: { id, schoolId }, select: { studentId } })`. Nothing found → `notFound("Catatan absensi tidak ditemukan.")`.
   - Run `withTx(applyReview)` with `windowLimited = role !== "SUPER_ADMIN"`.
2. **`applyReview`**
   - Take locks in order: `lockKey(attendanceLockKey(studentId))` → `lockStudentRow` → `lockRows(tx, "Attendance", [id])`.
   - Re-read `findFirst({ id, schoolId })`, including the reviewer `{id, name}`.
   - Run `planAnomalyReview`.
     - violation → `unprocessable` or `conflict`
     - unchanged → return `unchanged: true` with no write
   - For invalidate:
     - Run `assertCorrectableDate(tx, { scope, date: fromDbDate(row.date), windowLimited }, ctx.now)`.
     - Then `buildCorrectionPatch(snapshot, { status: "ALPHA", lateMinutes: null, reason: note })`. The result is `update`, or `noop` when the row is already ALPHA.
3. **Write**
   - `updateMany({ where: { id, schoolId }, data })`. If the count is not 1 → `CONFLICT_RETRY`. Then `findFirst`.
   - `data` = `{ anomalyReviewDecision, anomalyReviewedAt: ctx.now, anomalyReviewedById: principal.userId, anomalyReviewNote: normalizeReviewNote(note) }`, plus `patch.data` when the patch is an update.
4. **Audit** (last, once): `writeAudit` with action `attendance.anomaly_review`, entity `Attendance`.
   - `before` = `{ decision, note, status, source, lateMinutes }`.
   - `after` = the same fields plus `{ flags: parseFlags(anomalyFlags), date, studentId }`. The flags are a snapshot of what was reviewed.
   - No separate `attendance.correct` entry.
5. **Notify** only when the patch is an update: `notifyStudents(tx, [studentId], attendanceCorrectedNotification({ attendanceId, date, status: "ALPHA", lateMinutes: null, reason: note, actorRole }), ctx)`.
   - `statusChanged = patch?.kind === "update"`.

### 5.2 Read changes (additive)

- **`GET /school/attendance/anomalies`**
  - Add `review: z.enum(ANOMALY_REVIEW_FILTERS).default("UNREVIEWED")`.
  - The default range is `anomalyQueueDefaultDays(review)`. The 92-day cap stays.
  - `reviewFilterWhere` maps:
    - UNREVIEWED → `{anomalyReviewedAt: null}`
    - VALID or INVALID → `{anomalyReviewDecision}`
    - ALL → `{}`
  - Rows get a top-level `reviewDecision`.
- **`GET /school/attendance/daily`**: `anomaly=unreviewed` adds `anomalyReviewedAt: null`.
- **Brief (daily and anomalies) and map point**: add `needsReview` and `reviewDecision`. Selects add `anomalyReviewedAt` and `anomalyReviewDecision`.
- **Detail**: add `review` from `anomalyReviewNote` and `anomalyReviewedBy {id, name}`.
- **`export const PENDING_ANOMALY_REVIEW_WHERE = { hasAnomaly: true, anomalyReviewedAt: null } as const`**: the single server definition of "perlu ditinjau". N4 and any future badge use it.

### 5.3 Reopen on new flag

- **Check-in (`check-in-service.ts:304-326`).** `lockSharedDeviceRows` also selects `anomalyReviewDecision`. `flagSharedDevice` nulls the 4 review columns when `reopensOnNewFlag(decision)` is true.
- **Sweep (`sweep.ts`).** Add `reopenSharedDeviceReviews(tx, schoolId, date, now)` and run it before the existing statement.
  - It is a multi-table `UPDATE … JOIN` that uses the same shared-device subquery.
  - It sets the 4 columns to NULL and sets `updatedAt`.
  - Its WHERE is `` a.`anomalyReviewDecision` = 'VALID' AND NOT JSON_CONTAINS(flags, '"SHARED_DEVICE"') ``. It also matches when flags are NULL or not an array.
  - It is a separate statement because MariaDB does not order assignments in a multi-table UPDATE.

## 6. UI

**Detail dialog (`record-detail-dialog.tsx:19-58`).**
- New optional props `onReviewed?()` and `onCorrect?()`.
- When `data.hasAnomaly` is true, render `<AnomalyReviewPanel>` under the flags list (`:54`).
- After a review succeeds: reload the detail (`setRetry`), show a toast, and call `onReviewed`.

**New `anomaly-review-panel.tsx`** (< 150 lines).
- **Unreviewed.**
  - Pill "Perlu ditinjau".
  - Textarea "Catatan peninjauan" (maxLength 255, with counter). Help text: "Wajib bila Tidak valid — dikirim ke siswa."
  - Chips (`.review-chip`, `toggleQuickReason` from `review-rules.ts:57`): "Foto bukan wajah siswa", "Wajah tidak terlihat jelas", "HP dipakai siswa lain", "Tidak berada di sekolah".
  - Buttons side by side: **Valid** (secondary) and **Tidak valid** (danger-outline).
  - One line directly under them: "Valid: absensi tetap. Tidak valid: status jadi Alpa dan siswa diberi tahu."
  - The client validates with the server's `reviewNoteProblem`. On failure it shows an inline error: "Tulis alasan minimal 5 karakter — alasan ini dikirim ke siswa."
- **VALID.**
  - Line: "Valid · {reviewer} · {display(reviewedAt)}", plus the note.
  - Button "Ubah jadi tidak valid" next to it. It opens the same note area with a single **Tidak valid** button.
- **INVALID.**
  - Line: "Tidak valid · {reviewer} · {waktu}", plus the note.
  - Then "Perlu dipulihkan? Pakai Koreksi absensi." with a **Koreksi absensi** button next to it, wired to `onCorrect`.
- **Toasts.**
  - "Ditandai valid — keluar dari antrean Perlu ditinjau."
  - "Ditandai tidak valid — status jadi Alpa, siswa diberi tahu."
  - When `statusChanged` is false: "…status sudah Alpa."
- **Errors.** Inline `role="alert"` via `reviewErrorText`.
  - NOT_SCHOOL_DAY → "Tanggal ini bukan hari sekolah, jadi tidak bisa dijadikan Alpa — tandai Valid bila sudah diperiksa."
  - ANOMALY_ALREADY_INVALID → reload, then show the server message.

**New `record-host.tsx`.** `RecordHost({target, date, onClose, onChanged})` switches between `RecordDetailDialog` and `ActionDialog op={operation("correctStudentAttendanceDay")} initial={{studentId, date}}`.

**`use-monitor-data.ts`.** `sendAnomalyReview({attendanceId, date, decision, note, demo, schoolId})`.
- In demo mode it calls `applyDemoReview`.
- Otherwise it calls `api(scoped(path, schoolId), { method: "POST", body: JSON.stringify({decision, note}) })`.

**Peta & daftar.**
- **Legend.** `pendingReviewCount(points)`, counting `needsReview`. In `monitor-view.tsx:73` the prop is renamed `pendingReview`. The text "{n} perlu ditinjau" stays.
- **Pins and popup card** (`map-markup.ts:13,22,84`).
  - The "!" mark, the "perlu ditinjau" label, and `is-anomaly` now follow `needsReview`.
  - The card shows "Ditinjau: valid" or "Ditinjau: tidak valid".
- **List** (`monitor-list.tsx:71-73`). Tags come from `reviewTag()`:
  - "Perlu ditinjau" (`is-danger`)
  - "Valid" (`is-ok`)
  - "Tidak valid" (`is-muted`)
- `monitor-view.tsx:77` uses `RecordHost`. Its `onChanged` bumps `version`.

**Data lengkap.**
- `Workspace` (`workspace.tsx:23,68`) gets an optional prop `recordDialog?: ({row, viewPath, onClose, onChanged}) => ReactNode | null`, checked before the generic `RecordDialog`.
- `AttendanceMonitorPage` (`:27`) returns `RecordHost` for daily and anomalies rows, using `attendanceTargetOf(row, filterDate)`.
- `workspace-rules.ts`:
  - `detailBase` (`:159`) also maps `/school/attendance/anomalies` → `/school/attendance`.
  - `VIEW_COLUMNS` anomalies (`:210`) adds `reviewDecision`.
  - `ACTION_LABELS.reviewAttendanceAnomaly = "Tinjau anomali"` for the generic fallback.

**Labels (`format.ts:7`).**
- Change: `hasAnomaly` "Ada anomali".
- New:
  - `needsReview` "Perlu ditinjau"
  - `reviewDecision` "Hasil tinjauan"
  - `review` "Tinjauan"
  - `UNREVIEWED` "Belum ditinjau"
  - `VALID` "Valid"
  - `INVALID` "Tidak valid"
  - `reviewer` "Peninjau"

**CSS (`monitor.css`).** Add `.monitor-review`, `.row-tag.is-ok` (success tokens), and `.row-tag.is-muted`.

**Pure rules (`monitor-rules.ts`).** Add `pendingReviewCount`, `reviewTag`, `reviewSuccessText`, `reviewErrorText`, `attendanceTargetOf`, and `INVALID_REASON_CHIPS`.

**Demo (`demo-monitor.ts:52-77,155-199`).**
- `FLAG_TEXT` gains FACE_NOT_DETECTED and TEST_MODE.
- d24 Yoga Pratama gets `["FACE_NOT_DETECTED"]` and stays unreviewed.
- d20 becomes reviewed VALID ("Admin Demo", "HP baru, sudah dikonfirmasi wali kelas.").
- The legend still shows 3: d41, d23, d24.
- **Session overlay.** `let demoReviews: ReadonlyMap`, replaced immutably and reset on reload.
  - It is applied by map, daily, detail, and the new `demoAnomalyRows()`.
  - `demoMonitorRows("/school/attendance/anomalies")` returns unreviewed rows only.
- **`applyDemoReview`** reuses `planAnomalyReview` and `reviewNoteProblem`.
  - Violations throw `ApiError`.
  - INVALID → status ALPHA.
- `resetDemoReviews()` exists for tests.
- The panel notes: "Mode demo: keputusan hanya tersimpan di peramban ini sampai halaman dimuat ulang."

## 7. Tests

### Unit

| File | Cases |
|---|---|
| `anomaly-review-rules.test.ts` | Everything in §4. |
| `monitor-dto.test.ts` | Brief `needsReview` and `reviewDecision`. `toReviewDto`: null when there is no decision; maps reviewer and ISO time. |
| `monitor-rules.test.ts` | `reviewTag`, `pendingReviewCount`, `attendanceTargetOf` (anomaly row → its date; daily row → fallback date; no attendance → null), `reviewErrorText`. |
| `demo-monitor.test.ts` | Anomalies path. Legend shows 3. VALID → 2. INVALID without a note throws. INVALID → ALPHA with recounted counts. INVALID→VALID throws. Call `resetDemoReviews` in afterEach. |
| `workspace-rules.test.ts` | `detailBase(anomalies)`. The reachability test (`:90-105`) still passes. |

### Integration

New file `tests/integration/attendance/monitor/anomaly-review.test.ts`. It uses `checkInRow` (`jobs/fixtures.ts:118`), which gains `hasAnomaly?: boolean`, plus `pastSchoolDate`.

1. **VALID, no note.**
   - 200; review set; `needsReview` false; status unchanged.
   - Audit has `after.flags`. No notification.
   - The default queue excludes the record. `review=VALID` and `review=ALL` include it.
2. **INVALID on a TERLAMBAT check-in.**
   - Status ALPHA, `lateMinutes` null, source ADMIN, note set.
   - Evidence and flags are kept.
   - One audit, and no `attendance.correct`.
   - One `ATTENDANCE_CORRECTED` whose body contains "Alpha" and the note.
3. **Same decision again.** `unchanged`, with no new audit or notification.
4. **Decision changes.** VALID→INVALID succeeds. INVALID→VALID returns 409 and changes nothing.
5. **Row already ALPHA after a PUT, then INVALID.** `statusChanged` false; an audit is written; no notification.
6. **Only LOW flags.** 422 `NO_ANOMALY`.
7. **400 cases.**
   - INVALID with no note.
   - Note `"abc"` on INVALID.
   - Note `"ab"` on VALID.
   - `decision:"MAYBE"`.
   - An unknown field.
   - A note of 256 characters.
8. **50-day-old row.**
   - School admin INVALID → 422 `CORRECTION_WINDOW_EXPIRED`.
   - School admin VALID → 200.
   - Super admin INVALID → 200.
9. **Sunday row.** INVALID → 422 `NOT_SCHOOL_DAY`. VALID → 200.
10. **Access.**
    - 401 without a token.
    - 403 for a student.
    - 404 for the other school's admin, and for a super admin with the other school's `schoolId`.
    - 400 for a super admin with no `schoolId`.
11. **Race.** Two INVALID requests via `Promise.all` → one `statusChanged`, one `unchanged`. One notification and one audit in total.
12. **Reads.**
    - `daily?anomaly=unreviewed`.
    - Map `needsReview`.
    - Detail `review.reviewer.name`.
    - The 45-day default range.

Changes to existing files:

| File | Change |
|---|---|
| `monitoring.test.ts:145` | `?anomaly=unreviewed` → `?anomaly=FOO`, still 400. |
| `checkin/check-in-service.test.ts` | Retro SHARED_DEVICE clears a VALID review and keeps an INVALID one. |
| `jobs/auto-alpha.test.ts` | The sweep reopens VALID and keeps INVALID. A rerun is a no-op. |
| `platform/check-cases.ts` | `chk_attendance_anomaly_review`. Rejects: decision without `reviewedAt`; `reviewedAt` without decision; INVALID without a note; reviewed with `hasAnomaly=0`. Accepts: VALID without a note. |

### Browser and E2E

**Browser** (`tests/browser/attendance-monitor.spec.ts`, demo; run `pnpm test:frontend` locally):
1. The legend shows "3 perlu ditinjau".
2. Yoga Pratama → **Valid** → a toast appears and the legend shows 2.
3. Wulan Dari → **Tidak valid** with no note → an inline error. Pick the chip "HP dipakai siswa lain", then **Tidak valid** → status shows "Alpa", the "Koreksi absensi" button appears, and the legend shows 1.
4. Data lengkap → "Perlu ditinjau" shows 1 row.

**E2E** (`e2e/smoke.spec.ts:19`): add the assertion `AnomalyReviewDecision.INVALID === "Tidak valid"`.

**Then run:** `pnpm frontend:sync`, `pnpm openapi:export`, typecheck, lint, `test:unit`, and `test:int` (with `TEST_DB_NO_RESET=1`).

## 8. Docs

**`docs/PLAN.md`**
- Add a new Absensi bullet after "Deteksi wajah opsional": "**Tinjau anomali (pemilik 2026-10-03):** admin menandai catatan beranomali Valid/Tidak valid dari detail catatan; Tidak valid = koreksi menjadi Alpa (≤45 hari untuk admin sekolah, alasan wajib, audit + notifikasi siswa); flag tidak dihapus; Valid dibuka lagi bila flag baru muncul; antrean 'Perlu ditinjau' default belum ditinjau (45 hari)."
- In the Monitoring bullet, mention the `belum ditinjau` filter.
- Under "Ditunda": remove "workflow review anomali (koreksi manual dipakai)".

**`docs/backlog.md:17`**
- The item becomes IMPOSSIBLE_TRAVEL / IDENTICAL_COORDINATES only. Status: "tinjau anomali tersedia (2026-10-03)".
- New entries:
  - "Tinjau massal", triggered when FACE_NOT_DETECTED or TEST_MODE floods the queue.
  - "Pulihkan status otomatis saat Tidak valid dibatalkan".

**`docs/FRONTEND.md`**
- New section "Kehadiran admin — tinjau anomali": the panel, the Koreksi CTA, counts = `needsReview`, and the demo overlay.
- New structure bullet for `attendance-admin/`.

**`docs/design/02-attendance.md`**
- `:52,57-58`: `/school/…` paths, the `review` filter, note optional for VALID.
- `:226`: the reopen rule.
- `:333`: a single audit `attendance.anomaly_review`.
- `:549`: the test cases above.
- `:603-612`: the decision enum, the additive index, and the CHECK.
- Header note: "Diimplementasikan 2026-10-03 (B1); bila berbeda, PLAN & kode yang berlaku."

## 9. Edge cases & risks

| Case | Handling |
|---|---|
| New flag after a VALID review | It reopens (§5.3). INVALID reviews are never reopened. The old review stays in the audit. |
| Two admins at once | AppLock, Student and the Attendance row lock serialize them. The result is the stricter outcome: VALID→INVALID is allowed, INVALID→VALID gets 409. |
| INVALID on today's record | The record is ALPHA at once. A check-in retry gets 409. Auto-ALPHA skips the row. |
| Leave approved later for the same date | The record stays ALPHA. Approval never overwrites ADMIN rows, the same as Koreksi. |
| TEST_MODE check-in on a non-school day | INVALID gets 422 with a hint. The admin marks it VALID. |
| Inactive or graduated student | Review is allowed. `notifyStudents` skips inactive users. |
| Queue noise (FACE_NOT_DETECTED is MEDIUM) | One decision per record, a class filter, a 45-day default range. Bulk review is in the backlog. |
| Migration copies the Attendance table | One ALTER on a small table. Merge outside 06:00–10:00, together with A1's migration. Rollback is safe because all new columns are nullable. |
| A flag is added while the dialog is open | Accepted. The audit snapshot records which flags were actually reviewed. |

**HRIS lessons applied.**
- **Fingerprint (`scripts/schema.sql:864-882`).** HRIS ties each review to a fingerprint, so changed data makes the review void. Here, a new flag reopens a VALID review.
- **Removed triage page.** HRIS deleted its separate per-code "Absensi Abnormal" triage page (`app/api/absensi/anomali/route.ts:7-15`, commit 24eae8e). Here there is one decision per record, in the existing dialog and tab.
- **Server-only detection (`route.ts:12-15`).** HRIS keeps detection on the server only. Here, "perlu ditinjau" exists only in `needsAnomalyReview` and `PENDING_ANOMALY_REVIEW_WHERE`, and the demo reuses those pure rules.
- **Manual photo review.** HRIS `liveness_verified=0` leads to "kirim foto ini apa adanya untuk diperiksa admin" (`app/dashboardUser/absensi/page.tsx:958-976`). This panel is where our FACE_NOT_DETECTED promise is kept. Check-in is never blocked.
- **Snapshot of what was taken (`cuti.jatah_dipotong`).** HRIS learned that restoring by today's rule is wrong. So there is no automatic restore, and Koreksi requires an explicit status.

## 10. Open questions (owner)

1. **Should undoing INVALID automatically restore the original status?**
   Default: no. The admin uses Koreksi absensi (audited, explicit status).
2. **Can every admin account, teacher accounts included, mark Tidak valid?**
   Default: yes, the same as Koreksi today. The alternative is `primarySchoolAdminOnly`.
3. **Should the student's notification quote the note verbatim?**
   Default: yes, the same as Koreksi. The help text already says the note is sent.
4. **Bulk "Tandai valid" (e.g., TEST_MODE batches)?**
   Default: not in v1. It goes to the backlog.
