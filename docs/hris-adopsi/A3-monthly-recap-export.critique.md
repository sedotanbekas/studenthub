# Kritik adversarial — A3-monthly-recap-export

Verdict: Not ready to execute. There are two blockers. (1) The spec contradicts itself on its central counting rule. The §4b formula counts rows on UNCLOSED days, and it has to, because the report card, analytics and the spec's own consistency tests count them. But the matrix greys those cells, and the legend, the Excel note, the edge-case table and the HRIS section all say grey cells are "tidak dihitung". (2) Implemented as written, `pnpm test:unit` goes red: `field-labels.test.ts` needs labels for 8 new response keys. There are two majors. First, the rate limit counts every attempt, including failed ones, and the export caps disagree with each other, so the spec's own "unduh per kelas"/"unduh Excel" fallbacks fail for large schools and classes. Second, the late-reason counts drift from A1: they are untyped, have no "belum diisi" bucket, and use a different date cut than A1's endpoint. Verified sound: defineRoute passes a binary `Response` through and applies `rateLimit` (src/lib/http/route.ts:39,111-115); the `/api/web` proxy streams non-JSON bodies with Content-Type/Content-Disposition (src/app/api/web/[...path]/route.ts:124-131); exceljs 4.4.0 stores JS strings as String cells, so the formula-injection claim holds (node_modules/exceljs/lib/doc/cell.js:1066-1067); the import template really is documented as image/* in docs/openapi.json; no migration is needed (attendance.prisma:71-75 and student.prisma:73 cover every query). Most path:line references check out. Memory is not a problem: a local exceljs benchmark built 60 sheets × 34 students × 45 styled columns in ≈0.83 s at 191 MB RSS, against PM2's 1500M limit. Note: A1 is being implemented in this working tree right now (uncommitted `late-reason-*.ts`). A1 names below were checked against that code, and line numbers elsewhere refer to HEAD 0cd1d97.

1. **[blocker]** The spec says two incompatible things about rows on UNCLOSED days. Its formula counts them, but the screen, legend, Excel note and edge-case table say they are not counted.
   - Bukti: §4b Totals counts rows where `isCountedDate = date <= closedThrough`. `listUnclosedDates` only ever returns dates inside the period the caller already cut at closedThrough (src/lib/attendance/closure-queries.ts:25-30; spec §5.1 step 2-3 passes `cut`), so every UNCLOSED date is also a counted date. Every existing consumer counts these rows and only warns about them:
     - `getClassAnalytics` counts every row in the cut and only reports `unclosedDates` (src/lib/attendance/analytics-queries.ts:82-86,104-110).
     - The report card window ends at closedThrough and counts the rows; unclosed days only block publishing (src/lib/report-cards/attendance.ts:24-25,40-53,57-63).
     - Design 02 §3.10 says the same (docs/design/02-attendance.md:340-343).

     The spec contradicts this in five places:
     - The `cellDisplay` first row turns any code on a non-CLOSED day into `pending`, `final:false`.
     - The §6.1 legend says "Abu-abu = belum final, tidak dihitung".
     - §6.3 row 3 says "{n} hari belum ditutup tidak dihitung".
     - The §9 table says "Today's rows and unclosed days … never counted".
     - HRIS lesson 2 says the "pending/unclosed tones are excluded from totals".

     If the implementer follows those, consistency tests §7.5a (= getClassAnalytics) and §7.5c (= termAttendanceByStudent) fail. If they follow §4b, admins see grey cells labelled "not counted" that are inside the totals. For example, between dayEnd and the auto-alpha tick (or for days after a failed job), every check-in of the day is grey yet counted.
   - Perbaikan: Keep §4b: count every row up to closedThrough, as §10.1 already proposes. Change `cellDisplay` so that a code on an UNCLOSED day is final with its normal tone, because closing a day only adds missing ALPHA rows and never changes an existing one. Use `pending` only for OPEN days, and keep "?" for null on UNCLOSED days.
     - Legend: "Abu-abu = hari berjalan, belum dihitung · ? = hari belum ditutup, alpa otomatis bisa bertambah".
     - Excel row 3: "Belum final: hari berjalan belum dihitung; {n} hari belum ditutup sehingga alpa otomatis bisa bertambah."
     - Fix the §9 row and HRIS lesson 2 to match.
     - Unit tests: a HADIR row on an UNCLOSED day is counted with `final:true`; the same row on an OPEN day is not counted and is `pending`.
     - Integration case 4 must put a row on the UNCLOSED day and assert it is in the totals.
2. **[blocker]** `pnpm test:unit` goes red because 8 new response keys have no Indonesian label. The spec never mentions `field-labels.ts`.
   - Bukti: src/lib/frontend/field-labels.test.ts:33-53 collects every response key of every operation under a menu module's paths and fails on any key without a label. HIDDEN_VIEWS does not exempt an operation. The attendance module covers `/school/attendance` (src/lib/frontend/modules.ts:5), so `monitorAttendanceMonthlyRecap` is checked. I ran `hasLabel` (src/lib/frontend/format.ts:11) over the §5.1 DTO keys. Missing: `isFinal`, `lateReasonCategories`, `day`, `weekday`, `closure`, `cells`, `otherClasses`, `lateReasons`. A1's planned labels (`categories`, `filled`, `unfilled`, …) do not cover any of these. The binary export has no JSON body, so it adds no keys.
   - Perbaikan: Add these to src/lib/frontend/field-labels.ts:
     - `isFinal: "Data final"`
     - `lateReasonCategories: "Kategori alasan terlambat"`
     - `day: "Tanggal"`
     - `weekday: "Hari"`
     - `closure: "Status penutupan hari"`
     - `cells: "Kode per tanggal"`
     - `otherClasses: "Tercatat juga di kelas"`
     - `lateReasons: "Alasan terlambat per kategori"`

     List `field-labels.test.ts` under §7 "must stay green". Re-check the list after finding 4 changes the DTO.
3. **[major]** Every export attempt uses up rate-limit quota, including failed ones. With the 2,000-student cap, the "unduh per kelas" fallback is unusable for large schools. The screen's "unduh Excel" advice hits the same 200-student cap.
   - Bukti: `defineRoute` calls `applyRateLimit` before it parses input or runs the handler, and `hit()` always runs (src/lib/http/route.ts:39-42,69-76). So every 400/403/404/422 and every per-class download counts against EXPORT's 20 per 10 minutes. The §5.2 422 message says "unduh per kelas". A school over MAX_EXPORT_STUDENTS = 2,000 has about 55 or more classes at 32–36 students each, so one month takes three rate-limit windows, with at least 20 minutes of 429s.
   - Bukti (screen cap): The screen's 422 says "Kelas ini terlalu besar untuk ditampilkan; unduh Excel." But §5.2 step 2 exports one class through `loadClassSource`, and §5.1 step 4.3 says "over the cap means 422" with MAX_RECAP_STUDENTS = 200. The same class fails in the export too.
   - Bukti (cap size): The 2,000 cap looks arbitrary. The benchmark above took ≈0.8 s and 191 MB for 2,040 students. PM2 restarts the app at 1500M (ecosystem.config.cjs:27).
   - Bukti (`take`): `loadClassSource`'s groupBy and findMany have no `take`, against the module rule "selalu ber-SchoolScope & ber-take" (src/lib/attendance/monitoring-queries.ts:43).
   - Perbaikan:
     - Pass the cap into `loadClassSource`: 200 for the screen, the export cap for the export.
     - Set MAX_EXPORT_STUDENTS from a timed unit benchmark (for example, 4,000 students in under 3 s) instead of guessing.
     - Charge quota only for exports that succeed. Leave `rateLimit` off this contract. In the service, call `assertRateLimit("EXPORT", key)` (key = `u:<userId>`) before loading and `getLimiter("EXPORT").hit(key)` after the workbook is built. This is the existing manual pattern in src/lib/attendance/leave-service.ts:150-155, with the same key format as route.ts:72. Keep `errors: ["RATE_LIMITED"]` on the contract so OpenAPI still documents 429; the document only derives 429 from `rateLimit` (src/lib/openapi/document.ts:40).
     - Consider raising EXPORT to 30 per 10 minutes and putting the limit in the message: "… unduh per kelas (maks. 30 unduhan per 10 menit)."
     - Add `take: cap + 1` to the groupBy and findMany.
4. **[major]** The late-reason part drifts from A1. Categories are untyped, there is no "belum diisi" bucket, the Excel T column will not equal the category columns, and A1's endpoint and the recap give different numbers for the current month.
   - Bukti: A1 as implemented provides:
     - `LATE_REASON_CATEGORIES`/`LateReasonCode` and `LATE_REASON_LABELS` (src/lib/attendance/late-reason-rules.ts:12-15);
     - `countLateReasons`, which zero-fills the categories in canonical order and returns `unfilled` (:106-125);
     - a note in late-reason-queries.ts:11 saying `lateReasonGroups` is "juga dipakai rekap bulanan (A3)".

     A3 uses none of this. It counts into a `Record<string, number>` ("opaque string", §4a/§9) with no unfilled bucket. So `lateReasons[].category` is an untyped string in OpenAPI and in the frontend catalog. The Excel has "one column per late category" and no "Belum diisi" column, so T = 14 can sit next to category columns that sum to 9 with no explanation. A1's `/late-reasons` counts from the 1st of the month to *today* (late-reason-queries.ts:40-45, `resolveRange` up to today). A3 stops at closedThrough. For the current month, "Data lengkap → Alasan terlambat" and the recap disagree every school day until dayEnd. That is exactly the "two numbers" problem §1 promises to remove.
   - Perbaikan:
     - Type `TallyRow.lateReason` as `LateReasonCode | null`.
     - Count TERLAMBAT rows that have a null category as `lateUnfilled`.
     - Build the DTO with `countLateReasons`, e.g. `lateReasons: { filled, unfilled, categories: [{ category: z.enum(LATE_REASON_CATEGORIES), count }] }`.
     - Add a "Belum diisi" column after the category columns in the XLSX, and a matching chip in Ringkas.
     - Either make A1's view accept `month` and cut at closedThrough, or label it "s.d. hari ini".
     - Remove the stale comment at late-reason-queries.ts:11, or actually reuse `lateReasonGroups`.
5. **[minor]** "All counting goes through ONE pure tally … numbers cannot disagree" overstates the refactor, and consistency test 5c only passes under conditions the spec does not state.
   - Bukti (other counting paths): src/lib/attendance/student-dto.ts:84-125 (HEAD) has a second `StatusCounts` with upper-case keys and its own `round1`, `presentPct`, `monthSummary` and `termCounts`. The student's own month and term summaries use it (student-queries.ts:95-116,157). Class analytics, the summary and the trends use `countsFrom`/`summarize`/`buildClassRates` (analytics-queries.ts:104-122). None of these go through `tallyAttendance`.
   - Bukti (published cards): Published report cards show the frozen snapshot (src/lib/report-cards/detail.ts:85). Admins can still correct attendance up to 45 days back (correction-rules.ts:11), so a published card can legitimately differ from a later recap.
   - Bukti (test 5c): `termAttendanceByStudent` counts every class, including `classId = null`, from the term start (report-cards/attendance.ts:42-51; fixture TERM_START 2091-01-02, fixtures.ts:22). The screen recap requires a classId and never counts null-class rows. So the §9 claim "sheets sum to the report-card totals" only holds when the "Tanpa kelas" sheet is included, the windows are month-aligned, and the card is still a draft.
   - Bukti (refactor safety): The refactor itself is safe. The existing tests compare with deepEqual (src/lib/report-cards/rules.test.ts:68-92), nothing compares identity with `ZERO_ATTENDANCE`, and the Prisma enum matches `ATTENDANCE_STATUSES` exactly (prisma/schema/attendance.prisma:1-7).
   - Perbaikan: Reword §1 to "the report card's draft attendance, the admin student-month summary and the monthly recap share one pure tally". Either move student-dto's `monthSummary`/`termCounts` onto the tally too, or list them as out of scope. Add "published report cards are frozen" to §9. Pin test 5c's data: a single-class student, no null-class rows, rows only between TERM_START and closedThrough, summed over January–April.
6. **[minor]** Some class names crash the all-classes export with a 500, and the workbook's page setup and timestamp will come out wrong.
   - Bukti (sheet names): The exceljs 4.4.0 sheet-name setter throws on "History", on a leading or trailing apostrophe, and on a name that duplicates an existing one ignoring case (node_modules/exceljs/lib/doc/worksheet.js:144-171). `sheetNameFor` only strips `:\/?*[]` and dedupes with a case-sensitive `ReadonlySet`. It also never reserves the fixed last sheet "Keterangan", so a class named "Keterangan" or "Kelas 'A'" crashes the export. Class names are only unique within an academic year (prisma/schema/school.prisma:202). A July export can therefore hold two "X IPA 1" sheets, and " (2)" does not say which year.
   - Bukti (page setup): exceljs defaults are `fitToWidth: 1`, `fitToHeight: 1` and `paperSize: undefined` (worksheet.js:68-84). "Fit to one page wide" without `fitToHeight: 0` squeezes a 36-student sheet onto one page, and without paperSize 9 the page is not A4.
   - Bukti (timezone, filename): Row 2 hardcodes "WIB", but schools can be WITA or WIT (src/lib/time/zone.ts:6). The ASCII slug in `recapFileName` can come out empty for a non-Latin class name.
   - Perbaikan:
     - `sheetNameFor`: strip `*?:/\[]`, trim, strip leading and trailing `'`, fall back to "Kelas", and check duplicates against a lowercase `used` set seeded with "keterangan" and "history". Disambiguate same-named classes with the academic-year name.
     - Page setup: `{ paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 }`.
     - Row 2: use `school.timezone`.
     - Slug fallback: "kelas".
     - Add a unit test for each case, reading the file back with ExcelJS.
7. **[minor]** The `cellDisplay` table has overlapping rows with no stated order, and its colours and CSS classes are incomplete.
   - Bukti (overlaps): A K on an OPEN day matches both "code on a non-CLOSED day → pending" and "K → other". A null on a future holiday matches both "HOLIDAY → L" and "OPEN → pending"; DAY_OFF and OUTSIDE_TERM on OPEN days overlap the same way.
   - Bukti (colours): `RECAP_TONE_COLORS` claims "= styles/charts.css:13-18", but those lines only define hadir/terlambat/izin/sakit/alpha/belum. There are no tokens for other/holiday/off/pending/unclosed/none.
   - Bukti (CSS classes): §6.1 adds `.s-pending/.s-other/.s-holiday/.s-off`, but `cellDisplay` also returns `unclosed` and `none`, which get no class and render unstyled (monitor.css:10-15 has only the six status classes).
   - Perbaikan: Write `cellDisplay` as an ordered list:
     - **Code present:** OPEN → pending; K → other; otherwise the status tone (UNCLOSED stays final, per finding 1).
     - **Null:** HOLIDAY → "L"/holiday at any closure; DAY_OFF or OUTSIDE_TERM → off; OPEN → pending; UNCLOSED → "?"; CLOSED school day → "–"/none.

     Define the six new `--att-*` token triples once in charts.css, with matching `.s-*` classes. Mirror them in `RECAP_TONE_COLORS`, and add a unit test that parses charts.css and compares the hex values.
8. **[minor]** `TallyRow` leaves grouped late fields ambiguous: with `count: 3, lateMinutes: 10`, is that 10 or 30 minutes?
   - Bukti: In §4a, `count` is optional (default 1) and sits next to `lateMinutes`/`lateReason`, and the tests list "grouped weights". The report card passes grouped rows with no late data (report-cards/attendance.ts:52). The recap passes one row per record. Nothing defines how the two combine.
   - Perbaikan: State that `lateMinutes` is already summed for the group (never multiplied) and that `lateReason` adds `count`. Alternatively, reject late fields when `count !== 1`. Add one test for each choice.
9. **[minor]** A third tab will very likely make the page scroll sideways on phones. That breaks the existing 390px test and the spec's own "the page itself never scrolls sideways".
   - Bukti: `.monitor-tab` is `white-space: nowrap`, and `.monitor-tabs` has no overflow handling (src/styles/monitor.css:19-24). Below 759px the tabs only get `flex: 1; padding: 8px 12px` (:212-213). With a 15px bold label, a 17px icon, an 8px gap and 24px padding, "Peta & daftar", "Rekap bulanan" and "Data lengkap" come to an estimated ≈430-470px, against ≈358px available at 390px. The tabs always render, so tests/browser/attendance-monitor.spec.ts:97-101 ("tanpa luapan horizontal" on the map tab) would also fail. Other segmented controls already scroll (charts.css:103 `.segmented`, academics.css:82 `.acad-tabs`).
   - Perbaikan: At ≤759px give `.monitor-tabs` `overflow-x: auto; scrollbar-width: none`, or use short labels ("Peta", "Rekap", "Data"). Run the existing 390px test on the map tab too.
10. **[minor]** Several screen states and controls are under-specified.
    - Bukti (class list): `useClassOptions` returns only `ClassOption[]` and swallows errors into a toast (src/components/hub/attendance-admin/use-monitor-data.ts:26-38). "Belum ada kelas." would flash while loading and would also show when the request fails.
    - Bukti (school switch): The page owns `classId`, and nothing remounts it when a super admin switches school, so the old class id returns 404 "Kelas tidak ditemukan.".
    - Bukti (month input): `<input type="month">` is a plain text box in Firefox and desktop Safari. The repo already has a prev/next month control, `.month-nav` (src/components/hub/attendance/attendance-page.tsx:104).
    - Bukti (breakpoint, hooks): The "Ringkas below 768px" rule does not match the CSS breakpoint of 759px (monitor.css:209). Reading localStorage or matchMedia must use the deferred-setState pattern (src/components/hub/frame.tsx:35) to pass the react-hooks lint rules.
    - Bukti (notice): "Data s.d. {closedThrough}" reads wrong when closedThrough is before the 1st of the month.
    - Bukti (badge): For null-class rows the "Pindah kelas" badge would say "tercatat di Tanpa kelas".
    - Perbaikan:
      - Return `{ options, loading, error }` from the class hook.
      - Reset `classId` when `schoolId` changes, or when the id is not in the options.
      - Use `.month-nav` with prev/next buttons, disabling "next" past the current month.
      - Use 760px.
      - When no day is closed yet, show "Belum ada hari yang ditutup di bulan ini.".
      - For null-class rows, use the badge "Sebagian bulan tanpa kelas".
11. **[minor]** Demo mode shows different behaviour from the real app, and contradicts the map tab on the same screen.
    - Bukti: §6.2 and the §7 demo test make every OPEN cell null. Real data shows today's rows as grey codes (§4b "Cells still show rows on OPEN days"). The demo map tab, one click away, shows today's check-ins for the same roster (src/lib/frontend/demo-monitor.ts:48-70). A1 adds today's demo reasons for d16, d29 and others (A1 spec §6.4). The recap would show those students blank today.
    - Perbaikan: For today's column, overlay the demo-monitor LOCATED/UNLOCATED statuses as `pending` cells, and use A1's demo reasons. Keep earlier days hash-based. Change the test to "today's cells match demo-monitor; later days are null".
12. **[minor]** The tests as written will mis-fire, and two gate gaps are not covered.
    - Bukti (rate-limit test): The 429 case shares the `u:<adminId>` quota with the earlier export cases in the same file (route.ts:72), so the 429 arrives before the 21st call. `resetAllLimiters` exists for this (src/lib/http/rate-limits.ts:66).
    - Bukti (fixtures): `RowInput`/`rowData` cannot set `lateReasonCategory`/`lateReasonAt` (tests/integration/attendance/monitor/fixtures.ts:65-100). A1's `chk_attendance_late_reason` requires `lateReasonAt` whenever a category is set.
    - Bukti (student context): `getAttendanceMonth` needs a STUDENT ctx (student-queries.ts:95-96 `loadStudentSchool`), not `adminCtx`.
    - Bukti (NISN): `studentBriefSelect`/`toStudentBrief` select `nisn` (monitoring-queries.ts:114-120), so reusing them would leak NISN, and nothing tests that it doesn't.
    - Bukti (catalog): CI never runs `frontend:sync`, and the proxy returns 404 for any path missing from the catalog (src/app/api/web/[...path]/route.ts:21-23,106). A forgotten sync only shows up in production.
    - Perbaikan:
      - Call `resetAllLimiters()` in `beforeEach`, or use a dedicated admin for the 429 case.
      - Extend `RowInput` with `lateReasonCategory` and set `lateReasonAt` automatically.
      - Build a student ctx for the `getAttendanceMonth` comparison.
      - Forbid `studentBriefSelect` in the spec, and assert that neither the JSON nor the XLSX contains a `nisn` key or the fixture's NISN value.
      - Add a unit assertion in workspace-rules.test.ts that the catalog contains both new ids.
13. **[minor]** The spec collides with sibling specs and existing names.
    - Bukti (§3.11): A1 (A1-late-reason.md:344), N5 (N5-attendance-reminders.md:179) and A3 all add a "new §3.11" to docs/design/02-attendance.md.
    - Bukti (shared files): A3 edits the same files as A1 and B1: rate-limits.ts and its test, error-status.ts, monitor-schemas.ts, monitoring-queries.ts, contracts-monitor.ts, workspace-rules.ts, monitor.css, demo-monitor.ts and use-monitor-data.ts (B1-anomaly-review.md:32-35,244,278,282).
    - Bukti (`RecapRow`): The new `RecapRow` in monthly-recap-rules.ts reuses the name of the exported daily-recap `RecapRow` (src/lib/attendance/attendance-stats.ts:217), which A3's own code will also import from.
    - Perbaikan: Number the design sections in batch order: A1 → §3.11, A3 → §3.12, N5 → next. Rename the new types `MonthlyRecapRow`, `MonthlyRecapCandidate` and so on. Rebase on B1 after it merges, and append the new rate-limit and error codes at the end of their blocks.
14. **[minor]** Some references are wrong, and one stated reason is wrong.
    - Bukti (line numbers): use-monitor-data.ts has 80 lines: `useClassOptions` is at :26 and `useMonitorMap` at :44 (the spec says :169 and :187). "Pilih sekolah untuk memulai" is at monitor-view.tsx:33, not :75-81. `monitorScope` is at :61 and `assertClassInSchool` at :108.
    - Bukti (HIDDEN_VIEWS): Hiding the two ids is not what keeps the reachability test green. Every GET without path params is already a view (workspace-rules.ts:143-146), so the test (workspace-rules.test.ts:90-104) passes either way. The real reason is that both would otherwise show up as broken "Data lengkap" tabs. The recap tab would return 400 (`classId` is required). Each click on the export tab would build a workbook, write an audit row and use up quota, and then fail to parse as JSON.
    - Bukti (query count): It is about 12 queries plus auth, not about 10, because `listUnclosedDates` reloads the calendar (closure-queries.ts:35-41).
    - Bukti (HRIS paths): The HRIS paths (`exportAbsensi.ts`, `rekapPeriode.ts`, `absensi/riwayat/route.ts`) are in an external repo and cannot be checked from here.
    - Perbaikan: Correct the line numbers and give the real reason for HIDDEN_VIEWS. Either pass the already-loaded calendar into the unclosed-date lookup or state ≈12 queries. Mark the HRIS references as background only.
