# A3 — Rekap bulanan per kelas + ekspor Excel (spec)

Depends on A1 (late-reason category) being merged first. **No migration.**

## 1. Goal & non-goals

**Goal.** Admins (SCHOOL_ADMIN, and SUPER_ADMIN with `?schoolId=`) get a "Rekap bulanan" tab in Kehadiran. It shows one class for one month as a matrix: students as rows, days as columns, cell codes H/T/I/S/A, a holiday/non-school marker, and a grey "belum final" state. Each student also gets totals: hadir, terlambat with total minutes, izin, sakit, alpa, % hadir and A1 late-reason category counts. The same data downloads as XLSX, either one class or all classes (one sheet per class). All counting goes through ONE pure tally function. The report card's attendance and the admin student-month summary use that same function, so the numbers cannot disagree.

**Non-goals:**
- PDF export.
- Free date ranges or semester ranges.
- Drill-down from a cell, or editing in the matrix (corrections stay in "Koreksi absensi siswa").
- Per-class permissions for teacher accounts.
- A class picker for previous academic years ("Unduh semua kelas" covers this).
- NISN or A1 free-text reasons in any output.

## 2. Existing code to reuse/change

**Counting and calendar rules**
- `src/lib/attendance/attendance-stats.ts:25-78`: `StatusCounts`, `addStatus`, `countsFrom`, `recordedOf`, `presentOf`, `pct`. The new tally (§4a) is built on these. Also export the comparator at `:195` as `compareClassRows`.
- `src/lib/report-cards/rules.ts:45-73`: `summarizeAttendance*` becomes a projection of the tally. Signatures stay the same, so `report-cards/attendance.ts:52`, `publish-service.ts:48-53` and `detail.ts:73` are untouched.
- `src/lib/attendance/analytics-queries.ts:200-205`: `monthSummary` is derived from `tallyAttendance`. Output is identical.
- `auto-alpha-rules.ts:49` `closedThrough`, `:93` `eligibilityCutoff`; `closure-queries.ts:30` `listUnclosedDates`.
- `calendar/rules.ts:54,80` `checkSchoolDay`/`describeDays`; `calendar/queries.ts:49` `loadCalendarContext`.

**Monitoring queries and schemas**
- `monitoring-queries.ts`:
  - `:62-87` `monitorScope`/`loadMonitorSchool`: add `name` to the select and to `MonitorSchool`.
  - Also use `:98` `eligibleOn`, `:109` `assertClassInSchool` and `:131` `classNames`.
- `monitor-schemas.ts:9-45`: export `idString`, `dateOut`, `monthOut`, `monthField`.
- `contracts-monitor.ts:221`: add 2 contracts.
- `auth/policy/attendance.ts:13` `attendance.monitor` (ADMINS) is reused. No new action.

**HTTP and OpenAPI plumbing**
- `http/contract.ts:47-48` and `openapi/document.ts:70-84`:
  - Add an optional `binaryMediaTypes?: readonly string[]` to the contract (documentation only).
  - The document uses it, falling back to the image types.
  - Set it on `students/contracts.ts:145` too (that contract is wrongly documented as an image today).
- `http/rate-limits.ts:19-33`: add `EXPORT: { limit: 20, windowMs: 10 * MINUTE_MS }`. Update `rate-limits.test.ts:27`.
- `http/error-status.ts:73`: add `RECAP_TOO_LARGE: 422`.
- `students/import/template-service.ts:14-24`: copy its binary `Response` headers. Reuse `constants.ts:16` `XLSX_MIME`.
- `billing/format.ts:12,15`: `monthName` and `formatLocalDate` for the Indonesian labels.

**Frontend**
- `components/hub/attendance-admin/attendance-monitor-page.tsx:16-28`: tabs.
- `use-monitor-data.ts`:
  - `:169` `useClassOptions` serves the class picker.
  - Add `useMonthlyRecap` next to `useMonitorMap` (`:187`).
- `monitor-rules.ts:27-34` `STATUS_META` (letters and tones); `styles/monitor.css:10-15` `.s-*` tokens.
- `frontend/api.ts:18-25` `downloadApiFile`: when the response is not ok and is JSON, throw the server's `error.message`.
- `frontend/workspace-rules.ts:133-136`: add both new contract ids to `HIDDEN_VIEWS`, so the reachability test `workspace-rules.test.ts:90` keeps passing.
- `frontend/demo-monitor.ts:26`: export `ROSTER` as `DEMO_ROSTER`.

## 3. Data model

**No Prisma delta and no migration.** No `2026100307xxxx` folder is created. Existing indexes already cover every query:
- `Attendance @@index([classId, date])` and `[schoolId, date, classId, status]` (`prisma/schema/attendance.prisma:72-75`).
- `@@unique([studentId, date])` (`:71`).
- The Student primary key and the `currentClassId` foreign-key index.

Class membership uses the existing snapshot `Attendance.classId` (`:35-36`, "agar rekap kelas historis tetap benar"). The feature only reads A1's column, assumed to be `Attendance.lateReasonCategory` (nullable enum `LateReasonCategory`, labels in `platform/enum-labels.ts`). **Use the names A1 actually merged.**

## 4. Pure rules (write tests first)

### 4a. Shared tally (new section in `attendance-stats.ts`)

```ts
export interface TallyRow { readonly status: AttendanceStatusValue; readonly count?: number /*default 1*/; readonly lateMinutes?: number | null; readonly lateReason?: string | null }
export interface AttendanceTally { readonly counts: StatusCounts; readonly recorded: number; readonly present: number; readonly presentPct: number | null; readonly lateMinutes: number; readonly lateReasons: Readonly<Record<string, number>> }
export const EMPTY_TALLY: AttendanceTally;
export function addToTally(t: AttendanceTally, row: TallyRow): AttendanceTally; // immutable
export function tallyAttendance(rows: readonly TallyRow[]): AttendanceTally;
export function tallyByStudent(rows: readonly (TallyRow & { studentId: string })[]): ReadonlyMap<string, AttendanceTally>;
export function sumTallies(ts: readonly AttendanceTally[]): AttendanceTally;
export const isCountedDate = (date: LocalDate, closedThrough: LocalDate): boolean => date <= closedThrough;
```

Rules:
- `lateMinutes` and `lateReason` count only on TERLAMBAT rows.
- `presentPct = pct(present, recorded)`.
- `report-cards/rules.ts` adds `toReportCardAttendance(t) = { sick: counts.sakit, permit: counts.izin, absent: counts.alpha }`, and both `summarize*` functions delegate to the tally.

Tests:
- `attendance-stats.test.ts`:
  - grouped weights;
  - late fields ignored on non-TERLAMBAT rows;
  - empty input gives a null pct;
  - `counts` deep-equals `countsFrom`;
  - `sumTallies` is associative.
- `report-cards/rules.test.ts`: existing tests stay. Add one checking that `summarizeAttendanceByStudent` equals the projected `tallyByStudent`.

### 4b. `src/lib/attendance/monthly-recap-rules.ts` (+ `.test.ts`)

```ts
export const RECAP_CODES = ["H","T","I","S","A","K"] as const; // K = tercatat di kelas lain
export const STATUS_CODE: Readonly<Record<AttendanceStatusValue, RecapCode>>;
export type DayClosure = "CLOSED" | "UNCLOSED" | "OPEN";
export interface RecapDay { date: LocalDate; day: number; weekday: number /*1=Sen..7=Min*/; reason: DayReason; holidayName: string | null; closure: DayClosure }
export function buildRecapDays(days: readonly DayCheck[], closedThrough: LocalDate, unclosed: readonly LocalDate[]): RecapDay[];
export interface RecapRow { studentId: string; date: LocalDate; classId: string | null; status: AttendanceStatusValue; lateMinutes: number | null; lateReason: string | null }
export interface RecapCandidate { id: string; name: string; nis: string; status: StudentStatus; currentClassId: string | null; isCurrentEligible: boolean }
export interface ClassRecapStudent { studentId: string; name: string; nis: string; studentStatus: StudentStatus; cells: (RecapCode | null)[]; otherClassIds: (string | null)[]; totals: AttendanceTally }
export function buildClassRecap(i: { classKey: string | null; days: readonly RecapDay[]; closedThrough: LocalDate; candidates: readonly RecapCandidate[]; rows: readonly RecapRow[] }): { students: ClassRecapStudent[]; totals: AttendanceTally };
export function recapClassKeys(candidates: readonly RecapCandidate[], rows: readonly RecapRow[], names: ReadonlyMap<string, string>): (string | null)[];
export type CellTone = "hadir"|"terlambat"|"izin"|"sakit"|"alpha"|"other"|"holiday"|"off"|"pending"|"unclosed"|"none";
export function cellDisplay(day: RecapDay, code: RecapCode | null): { text: string; tone: CellTone; final: boolean };
export function sheetNameFor(name: string, used: ReadonlySet<string>): string;
export function recapFileName(month: string, className: string | null): string;
export const RECAP_TONE_COLORS: Readonly<Record<CellTone, { fill: string; ink: string }>>; // = styles/charts.css:13-18
```

**Closure of a day.**
- `OPEN`: the date is after `closedThrough`.
- `UNCLOSED`: the date is in `unclosed`.
- `CLOSED`: everything else.

**Membership (who is a row in class `classKey`).** A student is included if either holds:
- They have at least 1 row in the month whose snapshot class is `classKey`.
- They are `isCurrentEligible` and have no rows at all in the month. `isCurrentEligible` means ACTIVE, `currentClassId === classKey`, and activated before the end-of-month cutoff.

So a student who moves mid-month appears in both classes. A student who moved in after the month does not appear in it.

**Cells.**
- Row in this class: the status letter.
- Row in another class, or with a null class: `K`.
- No row: `null`.

**Totals.**
- Count only this class's rows where `isCountedDate` is true. Cells still show rows on OPEN days.
- Class totals = `sumTallies` over the students.

**Sort.** By name (`localeCompare("id",{sensitivity:"base"})`), then by NIS. `recapClassKeys` sorts class names numerically, with null ("Tanpa kelas") last.

**`cellDisplay`.**

| Situation | Text | Tone |
|---|---|---|
| Code on a day that is not CLOSED | the code | `pending` (`final:false`) |
| `K` | `K` | `other` |
| `null` on HOLIDAY | "L" | `holiday` |
| `null` on DAY_OFF or OUTSIDE_TERM | "" | `off` |
| `null` on OPEN | "" | `pending` |
| `null` on UNCLOSED | "?" | `unclosed` |
| `null` on a CLOSED school day | "–" | `none` ("tidak wajib absen") |

**`sheetNameFor`.**
- Strip `:\/?*[]`, trim, and cut to 31 characters.
- An empty result becomes "Kelas".
- Duplicates get " (2)", " (3)" and so on, still within 31 characters.

**`recapFileName`.** ASCII slug, for example `rekap-kehadiran-x-ipa-1-2026-09.xlsx` or `rekap-kehadiran-semua-kelas-2026-09.xlsx`.

Tests cover:
- every closure and every membership case (including "rows only in another class" and the null bucket);
- `K` cells, and an OPEN row that is shown but not counted;
- sort order, and class totals equal to the sum of students;
- every `cellDisplay` branch;
- sheet names, the file-name slug and the class-key order.

## 5. API

Both endpoints:
- live in `contracts-monitor.ts` (TAG "Absensi — Monitoring", action `attendance.monitor`);
- take a query of `monitorScopeQuery.extend(...)`;
- get their schemas from the new `monthly-recap-schemas.ts`;
- have a route at `src/app/api/v1/school/attendance/monthly-recap/route.ts` and `.../monthly-recap/export/route.ts` via `defineRoute`. The static segment wins over `[id]`.

After the contracts exist, run `pnpm openapi:export` and `pnpm frontend:sync`.

### 5.1 `GET /school/attendance/monthly-recap` — `monitorAttendanceMonthlyRecap`

**Query:** `{ schoolId?, classId: idString (required), month?: YYYY-MM }`. `month` defaults to the current local month. A future month is all OPEN.

**Response** `MonitorMonthlyRecap`:

```ts
{ month, monthLabel /*"September 2026"*/, class: { id, name }, closedThrough, isFinal /*range.to<=closedThrough && no unclosed*/,
  unclosedDates: date[], lateReasonCategories: string[] /*A1 enum order*/,
  days: [{ date, day, weekday, reason: DAY_REASONS, holidayName: string|null, closure }],
  students: [{ studentId, name, nis, studentStatus, cells: (RECAP_CODES|null)[], otherClasses: [{ id: string|null, name }], totals: AttendanceTally }],
  totals: AttendanceTally }
// AttendanceTally (meta id): { hadir, terlambat, izin, sakit, alpha, recorded, present, presentPct: number|null, lateMinutes, lateReasons: [{ category, count }] }
```

**Errors:**
- 400 `SCHOOL_ID_REQUIRED` / `VALIDATION_FAILED`
- 403 `SCOPE_MISMATCH`
- 404 `SCHOOL_NOT_FOUND`, `CLASS_NOT_FOUND` (also for another tenant's class)
- 422 `RECAP_TOO_LARGE` when there are more than `MAX_RECAP_STUDENTS = 200` students ("Kelas ini terlalu besar untuk ditampilkan; unduh Excel.")

**Flow** (`monthly-recap-queries.ts`, `getMonthlyRecap`). Read-only: no transaction, no locks. Every `where` includes `schoolId`.

1. `monitorScope`, then `loadMonitorSchool`, then `assertClassInSchool` (`findFirst({ id, schoolId })`).
2. Compute `range = monthRange(month)` and `closed = closedThrough(...)`. Cut the month at the closed date with `cutPeriod`.
3. Run in parallel: `loadCalendarContext(range)`, `listUnclosedDates(cut)` and `loadClassSource`.
4. `loadClassSource` runs a fixed set of queries (no N+1):
   1. `attendance.groupBy({ by:["studentId"], where:{ schoolId, classId, date: range } })`
   2. `student.findMany({ where:{ ...eligibleOn(school, range.to), currentClassId: classId }, take: MAX+1 })`
   3. `student.findMany({ where:{ schoolId, id:{ in } } })`. Merge with step 2; over the cap means 422.
   4. `attendance.findMany({ where:{ schoolId, studentId:{ in }, date: range }, select:{ studentId, date, classId, status, lateMinutes, lateReasonCategory } })`. Never select selfie, coordinates or note.
   5. `classNames` for the other classes.
5. Build `buildRecapDays(describeDays(...))`, then `buildClassRecap`, then map with `toMonthlyRecapDto`. That is about 10 queries in total.

### 5.2 `GET /school/attendance/monthly-recap/export` — `exportAttendanceMonthlyRecap`

**Contract settings:** `binary: true`, `binaryMediaTypes: [XLSX_MIME]`, `response: z.unknown()`, `rateLimit: { limiter: "EXPORT", key: "user" }`.

**Query:** `{ schoolId?, classId?, month? }`. Leaving out `classId` exports all classes.

**Errors:** everything in §5.1, plus:
- 429 `RATE_LIMITED`
- 422 `RECAP_TOO_LARGE` when there are more than `MAX_EXPORT_ROWS = 62_000` rows or `MAX_EXPORT_STUDENTS = 2_000` students ("Data bulan ini terlalu besar untuk satu berkas — unduh per kelas.")

**Flow** (`monthly-recap-export.ts`, `exportMonthlyRecap(ctx, query): Promise<Response>`):
1. Do steps 1–3 of §5.1.
2. Load the data:
   - One class: `loadClassSource`.
   - All classes: `loadSchoolSource` does `attendance.count` first as a guard, then:
     - one `findMany` for every row of the month;
     - students by id, plus all eligible ACTIVE students;
     - `classNames`, then `recapClassKeys`.
3. Build one `buildClassRecap` per class key, then `buildRecapWorkbook` (§6.3).
4. `withTx((tx) => writeAudit(tx, { action: "attendance.recap_export", entityType: classId ? "SchoolClass" : "School", entityId, schoolId, after: { month, classCount, studentCount } }, ctx))`. This writes only AuditLog, which comes last in the lock order (`tx.ts:12`).
5. Return a `Response` with these headers:
   - `Content-Type: XLSX_MIME`
   - `Content-Disposition: attachment; filename="<recapFileName>"`
   - `Content-Length`
   - `Cache-Control: no-store`
   - `nosniff`
   - `no-referrer`

## 6. UI

### 6.1 Tab and view

In `attendance-monitor-page.tsx`, the tabs become: Peta & daftar | **Rekap bulanan** (calendar icon) | Data lengkap. The page owns the `{ classId, month }` state.

New `monthly-recap-view.tsx`, plus `recap-matrix.tsx` and the pure `recap-view-rules.ts` with tests. Each file stays under 250 lines.

**Toolbar:**
- Class select (defaults to the first class).
- `<input type="month" max={current}>`.
- Toggle "Per tanggal | Ringkas". Default is "Ringkas" below 768px wide. The choice is kept in localStorage, wrapped in try/catch.
- Primary button **Unduh Excel**, secondary button **Unduh semua kelas**.

**States:**
- Super admin with no school selected: "Pilih sekolah untuk memulai" (as in `monitor-view.tsx:75-81`).
- No classes: "Belum ada kelas." with a **Buka Akademik** button right beside it.
- Loading: a skeleton, or the old data plus "Memperbarui…".
- Error: "Rekap belum berhasil dimuat" + the server message + **Coba lagi**.
- Class has no students: "Belum ada siswa di kelas ini pada September 2026."

**Summary line:** "Kehadiran 95,2% · Hadir 610 · Terlambat 14 (186 menit) · Izin 6 · Sakit 4 · Alpa 2".

**Notices (one line each):**
- When some days are still OPEN: "Data s.d. 12 September 2026; hari berjalan belum dihitung."
- When some days are UNCLOSED: "{n} hari belum ditutup (alpa otomatis) → angka bisa bertambah."

**Per tanggal view.**
- The matrix sits in its own horizontal scroller, so the page itself never scrolls sideways. No/Nama are sticky.
- Header cells show the day number and weekday initial. Non-school columns are shaded.
- Each cell is `td.recap-cell.s-{tone}` with the letter shown, so meaning never relies on colour alone. Its title shows the date, label and holiday name.
- After the day columns come H T I S A, % and Menit.
- Badges:
  - Students with `otherClasses` get "Pindah kelas", with title "Sebagian bulan tercatat di XI IPA 1".
  - Students who are not ACTIVE get a status badge with the enum label.

**Ringkas view.** A list with name, NIS, the totals, and late-reason chips.

**Legend:** "H Hadir · T Terlambat · I Izin · S Sakit · A Alpa · K Tercatat di kelas lain · L Libur · ? Belum ditutup · – Tidak wajib absen · Abu-abu = belum final, tidak dihitung."

**Download.**
- `downloadApiFile(scoped(path, schoolId), recapFileName(...))`.
- Success toast: "Rekap X IPA 1 September 2026 terunduh."
- Failure: a toast with the server message.
- The buttons are disabled while a download runs.

**CSS.** Add a "Rekap bulanan" block to `monitor.css` (about 60 lines). It reuses the `.s-*` tokens and adds `.s-pending/.s-other/.s-holiday/.s-off`.

### 6.2 Demo

`src/lib/frontend/demo-recap.ts` exports `demoMonthlyRecap({ classId, month, today })`:
- Roster: `DEMO_ROSTER`, filtered by demo class names `c0..c4` (`demo.ts:65`).
- Statuses come from a deterministic hash of studentId + date: H 85%, T 6%, I 3%, S 3%, A 3%.
- Late minutes run 3–25, and A1 categories cycle.
- School days are Mon–Fri. "HUT RI" is a holiday on 2026-08-17. Days from today onward are OPEN.
- Days and totals are built **with `buildRecapDays` and `buildClassRecap`**, not hand-written.

In demo mode, `useMonthlyRecap` never calls the API. Download only shows a toast: "Mode demo tidak mengunduh berkas. Masuk dengan akun sekolah untuk mengunduh Excel."

### 6.3 Workbook (`monthly-recap-xlsx.ts`, exceljs, no Prisma)

`buildRecapWorkbook({ schoolName, month, closedThrough, isFinal, unclosedCount, generatedAtLocal, lateReasonLabels, days, sheets: [{ className, recap }] }): Promise<Uint8Array>`

**One sheet per class**, named with `sheetNameFor`:
- Row 1 (title): "Rekap Kehadiran {kelas} — {bulan}".
- Row 2: "{sekolah} · Data final s.d. {tanggal} · Diunduh {DD/MM/YYYY HH:mm WIB}".
- Row 3, only when the month is not final: "Belum final: hari berjalan & {n} hari belum ditutup tidak dihitung."
- Row 5: No, NIS, Nama, days 1..N, H, T, I, S, A, % Hadir, Menit Terlambat, one column per late category, Keterangan.
- Row 6: weekday names.
- Cell fills come from `cellDisplay` + `RECAP_TONE_COLORS`. Holiday header cells carry a note with the holiday name.
- All values are numbers, not formulas. % uses the number format "0.0".
- A final "Jumlah kelas" row.
- Freeze panes at `xSplit 3`/`ySplit 6`. Page setup: A4 landscape, fit to one page wide.
- An empty class still gets the headers plus "Belum ada siswa".

**Last sheet "Keterangan"** holds the codes and these notes:
- "% Hadir = (H+T) ÷ hari tercatat s.d. tanggal final"
- "Kelas = kelas saat absen dicatat; siswa pindah muncul di kedua kelas"
- "Abu-abu = belum final"

## 7. Tests

**Unit (`pnpm test:unit`):**
- The tests in §4.
- `monthly-recap-xlsx.test.ts`: reload the output with ExcelJS and check:
  - sheet order, with "Keterangan" last;
  - headers, plus the fill and value of one H cell;
  - totals are numbers;
  - freeze panes;
  - the not-final note;
  - an empty class.
- `demo-recap.test.ts`:
  - passes `monthlyRecapSchema.parse` and is deterministic;
  - has as many days as the month;
  - OPEN cells are null;
  - totals equal the tally of the cells.
- `recap-view-rules.test.ts`.
- `rate-limits.test.ts` (EXPORT entry).
- `document.test.ts` (`binaryMediaTypes`).

**Integration:** new `tests/integration/attendance/monitor/monthly-recap.test.ts`. It uses the `fixtures.ts` helpers and the JobRun pattern from `analytics.test.ts:65`. Cases:
1. Matrix and totals for March 2091, mid-month: closures, "L", late minutes, category counts, `isFinal=false`.
2. A student who moves mid-month appears in both classes, with `K` cells, split totals and `otherClasses`.
3. A current member with no rows appears. A member whose rows are only in another class does not.
4. A day missing its JobRun is UNCLOSED.
5. **Consistency:**
   - Class totals equal the `getClassAnalytics` entry for that class.
   - A single-class student's totals equal `getStudentMonth` and `getAttendanceMonth`.
   - Summing all of one student's monthly recaps over the term window equals `termAttendanceByStudent`.
6. One-class export: XLSX headers, the file parses, and an audit row exists.
7. All-classes export: one sheet per class, plus "Tanpa kelas" when there are null-class rows.
8. `RECAP_TOO_LARGE`, with the caps injected through an options parameter.
9. The 21st export returns 429.

Also extend `access.test.ts:51-64` with both endpoints (`ownsId` via `classId`).

**E2E (CI):** `e2e/smoke.spec.ts` checks that both endpoints return 401 `UNAUTHENTICATED`.

**Browser (local):** add a "rekap bulanan (demo)" test to `tests/browser/attendance-monitor.spec.ts`:
- the tab opens and the matrix shows X IPA 1;
- changing the class changes the rows;
- the download button shows the demo toast;
- at 390px the view defaults to "Ringkas" and `noHorizontalOverflow` holds.

## 8. Docs to update

**`docs/PLAN.md`**
- Absensi monitoring bullet (≈l.207): add "**Rekap bulanan + ekspor Excel (pemilik 2026-10-03)**". Cover: the matrix codes; class = snapshot (a moved student appears in both classes); one tally shared with the report card; XLSX per class or all classes; audited and rate-limited; no NISN.
- "Ditunda": add "ekspor PDF & rekap rentang bebas/semester".

**`docs/backlog.md`** — add these rows:

| Item | Status sekarang | Kerjakan bila |
|---|---|---|
| Ekspor PDF rekap | — | Sekolah meminta cetak tanpa Excel |
| Pemilih kelas tahun ajaran lalu | Pakai "Unduh semua kelas" | Admin mengeluh Juli–Agustus |
| Rekap semester/rentang bebas | — | — |

**`docs/design/02-attendance.md`**
- §2: two endpoint rows.
- §3.10: "`tallyAttendance` = single counting function (rapor, rekap bulanan, bulan siswa admin)".
- New §3.11: membership, closure states, caps, workbook layout, audit.

**`docs/FRONTEND.md`**
- New section "Rekap bulanan kehadiran": modes, legend, download, demo.
- In "Struktur", add `src/components/hub/attendance-admin/` and `demo-recap.ts`.

## 9. Edge cases, risks, HRIS lessons

**Edge cases**

| Case | How it is handled |
|---|---|
| Moved class mid-month | Appears in both classes. Each sheet is snapshot-correct, and the sheets sum to the report-card totals. |
| MOVED or GRADUATED student | Rows keep them on the sheet with a status badge. Days after they left show "–". |
| Activated mid-month | Earlier days show "–" and are never counted as alpa. |
| Today's rows and unclosed days | Grey or "?", and never counted. |
| Holiday added after rows were recorded | The row wins and is counted (same rule as the report card). |
| Test-mode weekend rows | Shown and counted (same rule). |
| Previous-year months | Covered by "Unduh semua kelas" (sheets come from the data). |
| Large schools | Caps return 422 with a per-class instruction. |
| Reads are not in one transaction | A correction made during an export may show partially. Acceptable: the file is stamped "Diunduh …". |

**Risks**
- **Privacy.** Exports carry NIS only, never NISN. NISN is the login key and the initial password is now publicly known ("studenthubid"), so a leaked file with NISN would let someone take over student accounts. Exports also carry no coordinates, selfies or A1 free text. Every export is audited and rate-limited.
- **Formula injection.** exceljs writes strings as strings, so a name starting with "=" stays text.
- **Biggest risk: A1 naming drift.** The tally treats `lateReason` as an opaque string. Only the select and `lateReasonCategories` touch A1's names.

**HRIS lessons applied**
- `app/lib/exportAbsensi.ts:3-11`: recomputing an export eventually disagrees with the screen. Here, screen and file share `load*Source` + `buildClassRecap`, with totals per student and no per-date sheets.
- `exportAbsensi.ts:155-185,252`: marking a running day as a violation produced false accusations. Here, the `pending`/`unclosed` tones are excluded from totals and explained in the legend.
- `lib/rekapPeriode.ts:1-20,54`: one formula serves two official consumers, and ranges are bounded. Here, `tallyAttendance` is shared with the report card, and the range is one month plus the caps.
- `app/api/absensi/riwayat/route.ts:8-30`: select columns explicitly (no photos) and let the export reuse the screen's query. Done the same way here.

## 10. Open questions (owner-level; defaults proposed)

1. **% hadir denominator.** Default: rows recorded up to the final date, the same as the report card and analytics. The alternative is the number of school days.
2. **NISN in Excel** (for Dapodik). Default: excluded.
3. **Paper.** Default: A4 landscape. The alternative is F4.
4. **Signature block** (wali kelas / kepala sekolah). Default: none in v1.
5. **Restrict teacher accounts to their own class.** Default: no; all admins see all classes, as they do today.
