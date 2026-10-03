import ExcelJS from "exceljs";
import { ENUM_LABELS } from "@/lib/platform/enum-labels";
import { LATE_REASON_CATEGORIES, LATE_REASON_LABELS } from "./late-reason-rules";
import type { AttendanceTally } from "./attendance-stats";
import { RECAP_TONE_COLORS, cellDisplay, sheetNameFor, type ClassRecap, type MonthlyRecapDay, type MonthlyRecapStudent } from "./monthly-recap-rules";

/**
 * Workbook rekap bulanan (A3; exceljs, tanpa Prisma). Satu sheet per kelas + sheet "Keterangan" terakhir. Semua
 * angka berupa nilai (bukan rumus); teks nama selalu disimpan sebagai string (aman dari injeksi rumus). Tanpa NISN.
 */

export interface RecapSheetInput {
  readonly className: string;
  readonly recap: ClassRecap;
  /** Label kelas lain untuk kolom Keterangan (id -> nama; null = tanpa kelas). */
  readonly classLabel: (id: string | null) => string;
}

export interface RecapWorkbookInput {
  readonly schoolName: string;
  readonly monthLabel: string;
  /** "Data final s.d. 12 September 2026" atau "Belum ada hari yang ditutup di bulan ini". */
  readonly finalLine: string;
  /** Baris peringatan bila belum final; null = final. */
  readonly notFinalLine: string | null;
  /** "03/10/2026 14.05 WIB". */
  readonly generatedAt: string;
  readonly days: readonly MonthlyRecapDay[];
  readonly sheets: readonly RecapSheetInput[];
}

const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"] as const;
const HEAD_ROW = 5;
const FIRST_DATA_ROW = 7;
const FIXED_COLUMNS = 3;
const THIN = { style: "thin", color: { argb: "FFD5D9E0" } } as const;

const argb = (hex: string) => `FF${hex.slice(1).toUpperCase()}`;
const fill = (hex: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb: argb(hex) } });

const totalHeaders = (): string[] => ["H", "T", "I", "S", "A", "% Hadir", "Menit Terlambat", ...LATE_REASON_CATEGORIES.map((c) => LATE_REASON_LABELS[c]), "Alasan belum diisi"];

function totalValues(t: AttendanceTally): Array<number | null> {
  const byCategory = new Map(t.lateReasons.categories.map((c) => [c.category, c.count]));
  return [
    t.counts.hadir, t.counts.terlambat, t.counts.izin, t.counts.sakit, t.counts.alpha, t.presentPct, t.lateMinutes,
    ...LATE_REASON_CATEGORIES.map((c) => byCategory.get(c) ?? 0), t.lateReasons.unfilled,
  ];
}

function remarkOf(student: MonthlyRecapStudent, classLabel: RecapSheetInput["classLabel"]): string {
  const parts: string[] = [];
  if (student.studentStatus !== "ACTIVE") parts.push(`Status: ${ENUM_LABELS.StudentStatus[student.studentStatus]}`);
  const others = student.otherClassIds.filter((id): id is string => id !== null);
  if (others.length) parts.push(`Pindah kelas: sebagian bulan tercatat di ${others.map(classLabel).join(", ")}`);
  if (student.otherClassIds.includes(null)) parts.push("Sebagian bulan tanpa kelas");
  return parts.join(" · ");
}

function writeHeader(sheet: ExcelJS.Worksheet, input: RecapWorkbookInput, className: string): void {
  sheet.getCell(1, 1).value = `Rekap Kehadiran ${className} — ${input.monthLabel}`;
  sheet.getCell(1, 1).font = { bold: true, size: 14 };
  sheet.getCell(2, 1).value = `${input.schoolName} · ${input.finalLine} · Diunduh ${input.generatedAt}`;
  if (input.notFinalLine) {
    sheet.getCell(3, 1).value = input.notFinalLine;
    sheet.getCell(3, 1).font = { bold: true, color: { argb: argb(RECAP_TONE_COLORS.unclosed.ink) } };
  }
  const head = sheet.getRow(HEAD_ROW);
  const weekdays = sheet.getRow(HEAD_ROW + 1);
  head.values = ["No", "NIS", "Nama", ...input.days.map((d) => d.day), ...totalHeaders(), "Keterangan"];
  input.days.forEach((day, i) => {
    const column = FIXED_COLUMNS + 1 + i;
    weekdays.getCell(column).value = WEEKDAYS[day.weekday - 1] ?? "";
    if (day.reason !== "SCHOOL_DAY") [head.getCell(column), weekdays.getCell(column)].forEach((c) => (c.fill = fill(RECAP_TONE_COLORS.off.fill)));
    if (day.holidayName) head.getCell(column).note = day.holidayName;
  });
  head.font = { bold: true };
  weekdays.font = { italic: true, color: { argb: argb(RECAP_TONE_COLORS.off.ink) } };
}

function writeStudent(sheet: ExcelJS.Worksheet, rowNumber: number, index: number, student: MonthlyRecapStudent, days: readonly MonthlyRecapDay[], classLabel: RecapSheetInput["classLabel"]): void {
  const row = sheet.getRow(rowNumber);
  row.values = [index + 1, student.nis, student.name];
  days.forEach((day, i) => {
    const shown = cellDisplay(day, student.cells[i] ?? null);
    const cell = row.getCell(FIXED_COLUMNS + 1 + i);
    cell.value = shown.text;
    cell.fill = fill(RECAP_TONE_COLORS[shown.tone].fill);
    cell.font = { color: { argb: argb(RECAP_TONE_COLORS[shown.tone].ink) }, bold: shown.final && shown.tone !== "none" };
    cell.alignment = { horizontal: "center" };
  });
  const start = FIXED_COLUMNS + days.length + 1;
  writeTotals(row, start, student.totals);
  row.getCell(start + totalHeaders().length).value = remarkOf(student, classLabel);
}

const PCT_INDEX = 5;

function writeTotals(row: ExcelJS.Row, start: number, totals: AttendanceTally): void {
  totalValues(totals).forEach((value, i) => {
    const cell = row.getCell(start + i);
    cell.value = value;
    if (i === PCT_INDEX) cell.numFmt = "0.0";
  });
}

function styleSheet(sheet: ExcelJS.Worksheet, days: number, lastRow: number): void {
  const totalCount = totalHeaders().length;
  sheet.columns = [
    { width: 5 }, { width: 13 }, { width: 28 },
    ...Array.from({ length: days }, () => ({ width: 4 })),
    ...Array.from({ length: 5 }, () => ({ width: 5 })), { width: 8 }, { width: 9 },
    ...Array.from({ length: totalCount - 7 }, () => ({ width: 11 })),
    { width: 40 },
  ];
  for (let r = HEAD_ROW; r <= lastRow; r++) sheet.getRow(r).eachCell({ includeEmpty: true }, (cell) => (cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }));
  sheet.views = [{ state: "frozen", xSplit: FIXED_COLUMNS, ySplit: HEAD_ROW + 1 }];
  sheet.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${HEAD_ROW}:${HEAD_ROW + 1}` };
}

function addClassSheet(workbook: ExcelJS.Workbook, used: Set<string>, input: RecapWorkbookInput, sheetInput: RecapSheetInput): void {
  const name = sheetNameFor(sheetInput.className, used);
  used.add(name.toLowerCase());
  const sheet = workbook.addWorksheet(name);
  writeHeader(sheet, input, sheetInput.className);
  const { students, totals } = sheetInput.recap;
  students.forEach((student, i) => writeStudent(sheet, FIRST_DATA_ROW + i, i, student, input.days, sheetInput.classLabel));
  const sumRow = sheet.getRow(FIRST_DATA_ROW + students.length);
  if (students.length === 0) sumRow.getCell(3).value = "Belum ada siswa";
  else {
    sumRow.getCell(3).value = "Jumlah kelas";
    writeTotals(sumRow, FIXED_COLUMNS + input.days.length + 1, totals);
  }
  sumRow.font = { bold: true };
  styleSheet(sheet, input.days.length, sumRow.number);
}

const LEGEND: ReadonlyArray<readonly [string, string]> = [
  ["H", "Hadir"], ["T", "Terlambat"], ["I", "Izin"], ["S", "Sakit"], ["A", "Alpa"],
  ["K", "Tercatat di kelas lain pada hari itu"], ["L", "Libur"], ["?", "Hari belum ditutup — alpa otomatis bisa bertambah"],
  ["–", "Tidak wajib absen (belum aktif / sudah keluar)"], ["Abu-abu", "Hari berjalan — ditampilkan tetapi belum dihitung"],
];

const NOTES = [
  "% Hadir = (H + T) ÷ hari tercatat s.d. tanggal final.",
  "Kelas = kelas saat absen dicatat; siswa yang pindah kelas muncul di kedua kelas.",
  "Alasan belum diisi = absen sendiri yang terlambat tanpa alasan; terlambat yang dicatat admin tanpa alasan tidak masuk kolom alasan.",
  "Berkas ini tidak memuat NISN, foto, maupun lokasi siswa.",
];

function addLegendSheet(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.addWorksheet("Keterangan");
  sheet.columns = [{ width: 10 }, { width: 90 }];
  sheet.addRow(["Kode", "Arti"]).font = { bold: true };
  LEGEND.forEach(([code, meaning]) => sheet.addRow([code, meaning]));
  sheet.addRow([]);
  NOTES.forEach((note) => sheet.addRow(["", note]));
}

export async function buildRecapWorkbook(input: RecapWorkbookInput): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "studenthub.id";
  const used = new Set<string>();
  for (const sheetInput of input.sheets) addClassSheet(workbook, used, input, sheetInput);
  addLegendSheet(workbook);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
