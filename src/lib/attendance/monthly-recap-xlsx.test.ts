import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import type { DayCheck } from "@/lib/calendar/rules";
import { MAX_EXPORT_STUDENTS, buildClassRecap, buildRecapDays, type MonthlyRecapCandidate, type MonthlyRecapRow } from "./monthly-recap-rules";
import { buildRecapWorkbook, type RecapWorkbookInput } from "./monthly-recap-xlsx";

const school = (date: string): DayCheck => ({ date, isSchoolDay: true, reason: "SCHOOL_DAY", holidayName: null });
const DAYS = buildRecapDays(
  [school("2026-09-01"), { date: "2026-09-02", isSchoolDay: false, reason: "HOLIDAY", holidayName: "Libur uji" }, school("2026-09-03"), school("2026-09-04")],
  "2026-09-03",
  [],
);
const candidate = (id: string, name: string, currentClassId: string | null = "X"): MonthlyRecapCandidate => ({ id, name, nis: `N-${id}`, status: "ACTIVE", currentClassId, isCurrentEligible: true });
const row = (studentId: string, date: string, status: MonthlyRecapRow["status"], extra: Partial<MonthlyRecapRow> = {}): MonthlyRecapRow => ({
  studentId, date, classId: "X", status, source: "CHECKIN", lateMinutes: status === "TERLAMBAT" ? 12 : null, lateReason: null, ...extra,
});

function input(sheets: RecapWorkbookInput["sheets"], notFinalLine: string | null = "Belum final: hari berjalan belum dihitung."): RecapWorkbookInput {
  return { schoolName: "SMA Uji", monthLabel: "September 2026", finalLine: "Data final s.d. 3 September 2026", notFinalLine, generatedAt: "04/09/2026 10.00 WITA", days: DAYS, sheets };
}

const recapX = buildClassRecap({
  classKey: "X",
  days: DAYS,
  closedThrough: "2026-09-03",
  candidates: [candidate("a", "=HYPERLINK(\"x\")"), candidate("b", "Budi", "Y")],
  rows: [row("a", "2026-09-01", "HADIR"), row("a", "2026-09-03", "TERLAMBAT", { lateReason: "WEATHER" }), row("a", "2026-09-04", "HADIR"), row("b", "2026-09-01", "ALPHA"), row("b", "2026-09-03", "HADIR", { classId: "Y" })],
});

async function load(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
  return workbook;
}

test("workbook: sheet per kelas + Keterangan terakhir, header, sel berwarna, angka (bukan rumus), freeze, A4 lanskap", async () => {
  const empty = buildClassRecap({ classKey: "Z", days: DAYS, closedThrough: "2026-09-03", candidates: [], rows: [] });
  const label = (id: string | null) => (id === "Y" ? "X IPA 2" : "Tanpa kelas");
  const workbook = await load(await buildRecapWorkbook(input([{ className: "X IPA 1", recap: recapX, classLabel: label }, { className: "Keterangan", recap: empty, classLabel: label }])));
  assert.deepEqual(workbook.worksheets.map((s) => s.name), ["X IPA 1", "Keterangan (2)", "Keterangan"]);
  const sheet = workbook.getWorksheet("X IPA 1")!;
  assert.equal(sheet.getCell("A1").value, "Rekap Kehadiran X IPA 1 — September 2026");
  assert.equal(sheet.getCell("A2").value, "SMA Uji · Data final s.d. 3 September 2026 · Diunduh 04/09/2026 10.00 WITA");
  assert.equal(sheet.getCell("A3").value, "Belum final: hari berjalan belum dihitung.");
  const head = (sheet.getRow(5).values as unknown[]).slice(1);
  assert.deepEqual(head.slice(0, 7), ["No", "NIS", "Nama", 1, 2, 3, 4]);
  assert.deepEqual(head.slice(7, 14), ["H", "T", "I", "S", "A", "% Hadir", "Menit Terlambat"]);
  assert.deepEqual(head.slice(-2), ["Alasan belum diisi", "Keterangan"]);
  assert.equal(sheet.getCell(5, 5).note, "Libur uji");
  assert.deepEqual((sheet.getRow(6).values as unknown[]).slice(4, 8), ["Sel", "Rab", "Kam", "Jum"]);
  // Urut nama: "=" diurutkan sebelum huruf, jadi baris 7 = nama berawalan "=", baris 8 = Budi.
  const nameCol = (r: number) => sheet.getCell(r, 3).value;
  assert.deepEqual([nameCol(7), nameCol(8)], ["=HYPERLINK(\"x\")", "Budi"]);
  assert.equal(sheet.getCell(7, 3).type, ExcelJS.ValueType.String, "nama berawalan = tetap teks");
  const h = sheet.getCell(7, 4);
  assert.equal(h.value, "H");
  assert.equal((h.fill as ExcelJS.FillPattern).fgColor?.argb, "FFDCF2E9");
  assert.equal(sheet.getCell(7, 5).value, "L");
  assert.equal(sheet.getCell(7, 7).value, "H", "hari berjalan tetap tampil");
  assert.equal((sheet.getCell(7, 7).fill as ExcelJS.FillPattern).fgColor?.argb, "FFEEF0F3");
  assert.deepEqual([8, 9, 10, 11, 12, 13, 14].map((c) => sheet.getCell(7, c).value), [1, 1, 0, 0, 0, 100, 12]);
  assert.equal(sheet.getCell(7, 13).numFmt, "0.0");
  assert.equal(sheet.getCell(8, 6).value, "K");
  assert.match(String(sheet.getCell(8, head.length).value), /Pindah kelas: sebagian bulan tercatat di X IPA 2/);
  assert.equal(sheet.getCell(9, 3).value, "Jumlah kelas");
  assert.deepEqual([8, 9, 12].map((c) => sheet.getCell(9, c).value), [1, 1, 1]);
  for (let c = 1; c <= head.length; c++) assert.notEqual(sheet.getCell(9, c).type, ExcelJS.ValueType.Formula);
  assert.deepEqual([sheet.views[0]?.state, (sheet.views[0] as { xSplit?: number }).xSplit, (sheet.views[0] as { ySplit?: number }).ySplit], ["frozen", 3, 6]);
  assert.deepEqual([sheet.pageSetup.paperSize, sheet.pageSetup.orientation, sheet.pageSetup.fitToWidth, sheet.pageSetup.fitToHeight], [9, "landscape", 1, 0]);
  const emptySheet = workbook.getWorksheet("Keterangan (2)")!;
  assert.equal(emptySheet.getCell(7, 3).value, "Belum ada siswa");
  const legend = workbook.getWorksheet("Keterangan")!;
  assert.match(JSON.stringify(legend.getSheetValues()), /tidak memuat NISN/);
  assert.doesNotMatch(JSON.stringify(sheet.getSheetValues()), /nisn/i);
});

test("workbook final: tanpa baris peringatan", async () => {
  const workbook = await load(await buildRecapWorkbook(input([{ className: "X IPA 1", recap: recapX, classLabel: () => "" }], null)));
  assert.equal(workbook.getWorksheet("X IPA 1")!.getCell("A3").value, null);
});

test(`batas ekspor ${MAX_EXPORT_STUDENTS} siswa (120 kelas × 31 hari) dibangun < 15 detik`, async () => {
  const days = buildRecapDays(Array.from({ length: 30 }, (_, i) => school(`2026-09-${String(i + 1).padStart(2, "0")}`)), "2026-09-30", []);
  const perClass = Math.ceil(MAX_EXPORT_STUDENTS / 120);
  const statuses = ["HADIR", "HADIR", "HADIR", "TERLAMBAT", "IZIN", "SAKIT", "ALPHA"] as const;
  const sheets = Array.from({ length: 120 }, (_, k) => {
    const candidates = Array.from({ length: perClass }, (_, i) => candidate(`c${k}s${i}`, `Siswa ${k}-${i}`, `C${k}`));
    const rows = candidates.flatMap((c, i) => days.map((d, j) => ({ ...row(c.id, d.date, statuses[(i + j) % statuses.length]!), classId: `C${k}` })));
    return { className: `Kelas ${k}`, recap: buildClassRecap({ classKey: `C${k}`, days, closedThrough: "2026-09-30", candidates, rows }), classLabel: () => "" };
  });
  const started = Date.now();
  const bytes = await buildRecapWorkbook({ ...input(sheets, null), days });
  assert.ok(bytes.byteLength > 0);
  assert.ok(Date.now() - started < 15_000, `butuh ${Date.now() - started} ms`);
});
