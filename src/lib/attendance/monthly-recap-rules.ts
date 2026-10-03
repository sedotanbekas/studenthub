import type { AttendanceSource, StudentStatus } from "@prisma/client";
import type { DayCheck, DayReason } from "@/lib/calendar/rules";
import type { LocalDate } from "@/lib/time/zone";
import { EMPTY_TALLY, isCountedDate, sumTallies, tallyAttendance, type AttendanceStatusValue, type AttendanceTally } from "./attendance-stats";
import type { LateReasonCode } from "./late-reason-rules";

/**
 * Rekap bulanan per kelas (A3, murni — dipakai server, Excel, dan demo). Kelas = snapshot `Attendance.classId`
 * saat baris dicatat; siswa yang pindah di tengah bulan muncul di kedua kelas. Angka dihitung dengan tally
 * bersama (`tallyAttendance`) atas hari s.d. closedThrough — hari "belum ditutup" ikut dihitung (penutupan hanya
 * menambah ALPHA, tidak mengubah baris yang ada), hari berjalan tidak.
 */

/** H/T/I/S/A = status; K = hari itu tercatat di kelas lain (atau tanpa kelas). */
export const RECAP_CODES = ["H", "T", "I", "S", "A", "K"] as const;
export type RecapCode = (typeof RECAP_CODES)[number];

export const STATUS_CODE: Readonly<Record<AttendanceStatusValue, Exclude<RecapCode, "K">>> = { HADIR: "H", TERLAMBAT: "T", IZIN: "I", SAKIT: "S", ALPHA: "A" };

/**
 * Batas: layar per kelas; ekspor (siswa & baris). 4.000 siswa × 30 hari dibangun ≈ 2,6 detik (benchmark di
 * monthly-recap-xlsx.test.ts) — jauh di bawah batas memori PM2.
 */
export const MAX_RECAP_STUDENTS = 200;
export const MAX_EXPORT_STUDENTS = 4000;
export const MAX_EXPORT_ROWS = MAX_EXPORT_STUDENTS * 31;

export type DayClosure = "CLOSED" | "UNCLOSED" | "OPEN";
export const DAY_CLOSURES = ["CLOSED", "UNCLOSED", "OPEN"] as const satisfies readonly DayClosure[];

export interface MonthlyRecapDay {
  readonly date: LocalDate;
  readonly day: number;
  /** 1 = Senin ... 7 = Minggu. */
  readonly weekday: number;
  readonly reason: DayReason;
  readonly holidayName: string | null;
  readonly closure: DayClosure;
}

const weekdayOf = (date: LocalDate): number => ((new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7) + 1;

/** OPEN = setelah closedThrough; UNCLOSED = hari sekolah tertutup tanpa penutupan auto-ALPHA; lainnya CLOSED. */
export function buildRecapDays(days: readonly DayCheck[], closedThrough: LocalDate, unclosed: readonly LocalDate[]): MonthlyRecapDay[] {
  const pending = new Set(unclosed);
  return days.map((d) => ({
    date: d.date,
    day: Number(d.date.slice(8, 10)),
    weekday: weekdayOf(d.date),
    reason: d.reason,
    holidayName: d.holidayName,
    closure: !isCountedDate(d.date, closedThrough) ? "OPEN" : pending.has(d.date) ? "UNCLOSED" : "CLOSED",
  }));
}

export interface MonthlyRecapRow {
  readonly studentId: string;
  readonly date: LocalDate;
  readonly classId: string | null;
  readonly status: AttendanceStatusValue;
  readonly source: AttendanceSource;
  readonly lateMinutes: number | null;
  readonly lateReason: LateReasonCode | null;
}

export interface MonthlyRecapCandidate {
  readonly id: string;
  readonly name: string;
  readonly nis: string;
  readonly status: StudentStatus;
  readonly currentClassId: string | null;
  /** ACTIVE & diaktifkan sebelum batas akhir bulan (definisi eligibleOn). */
  readonly isCurrentEligible: boolean;
}

export interface MonthlyRecapStudent {
  readonly studentId: string;
  readonly name: string;
  readonly nis: string;
  readonly studentStatus: StudentStatus;
  readonly cells: ReadonlyArray<RecapCode | null>;
  /** Kelas lain (null = tanpa kelas) tempat siswa tercatat di bulan ini, urut kemunculan. */
  readonly otherClassIds: ReadonlyArray<string | null>;
  readonly totals: AttendanceTally;
}

export interface ClassRecap {
  readonly students: MonthlyRecapStudent[];
  readonly totals: AttendanceTally;
}

function rowsByStudent(rows: readonly MonthlyRecapRow[]): Map<string, MonthlyRecapRow[]> {
  const map = new Map<string, MonthlyRecapRow[]>();
  for (const row of rows) map.set(row.studentId, [...(map.get(row.studentId) ?? []), row]);
  return map;
}

/** Anggota kelas: punya baris di kelas ini, atau anggota layak saat ini tanpa baris sama sekali di bulan ini. */
const isMember = (candidate: MonthlyRecapCandidate, own: readonly MonthlyRecapRow[], classKey: string | null): boolean =>
  own.some((r) => r.classId === classKey) || (own.length === 0 && candidate.isCurrentEligible && candidate.currentClassId === classKey);

const byNameThenNis = (a: MonthlyRecapStudent, b: MonthlyRecapStudent): number =>
  a.name.localeCompare(b.name, "id", { sensitivity: "base" }) || a.nis.localeCompare(b.nis, "id", { numeric: true });

function studentRecap(candidate: MonthlyRecapCandidate, own: readonly MonthlyRecapRow[], input: ClassRecapInput): MonthlyRecapStudent {
  const byDate = new Map(own.map((r) => [r.date, r]));
  const cells = input.days.map((day) => {
    const row = byDate.get(day.date);
    if (!row) return null;
    return row.classId === input.classKey ? STATUS_CODE[row.status] : "K";
  });
  const others = [...new Set(own.filter((r) => r.classId !== input.classKey).map((r) => r.classId))];
  const counted = own.filter((r) => r.classId === input.classKey && isCountedDate(r.date, input.closedThrough));
  return {
    studentId: candidate.id,
    name: candidate.name,
    nis: candidate.nis,
    studentStatus: candidate.status,
    cells,
    otherClassIds: others,
    totals: tallyAttendance(counted.map((r) => ({ status: r.status, lateMinutes: r.lateMinutes, lateReason: r.lateReason, source: r.source }))),
  };
}

export interface ClassRecapInput {
  readonly classKey: string | null;
  readonly days: readonly MonthlyRecapDay[];
  readonly closedThrough: LocalDate;
  readonly candidates: readonly MonthlyRecapCandidate[];
  readonly rows: readonly MonthlyRecapRow[];
}

export function buildClassRecap(input: ClassRecapInput): ClassRecap {
  const grouped = rowsByStudent([...input.rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)));
  const students = input.candidates
    .filter((c) => isMember(c, grouped.get(c.id) ?? [], input.classKey))
    .map((c) => studentRecap(c, grouped.get(c.id) ?? [], input))
    .sort(byNameThenNis);
  return { students, totals: students.length ? sumTallies(students.map((s) => s.totals)) : EMPTY_TALLY };
}

/** Kunci kelas untuk ekspor semua kelas (aturan keanggotaan yang sama), urut nama numerik; tanpa kelas terakhir. */
export function recapClassKeys(candidates: readonly MonthlyRecapCandidate[], rows: readonly MonthlyRecapRow[], names: ReadonlyMap<string, string>): Array<string | null> {
  const withRows = new Set(rows.map((r) => r.studentId));
  const keys = new Set<string | null>(rows.map((r) => r.classId));
  for (const c of candidates) if (c.isCurrentEligible && !withRows.has(c.id)) keys.add(c.currentClassId);
  const nameOf = (key: string) => names.get(key) ?? "";
  return [...keys].sort((a, b) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : nameOf(a).localeCompare(nameOf(b), "id", { numeric: true })));
}

// ----------------------------------------------------------------------------- tampilan sel

export type CellTone = "hadir" | "terlambat" | "izin" | "sakit" | "alpha" | "other" | "holiday" | "off" | "pending" | "unclosed" | "none";
export const CELL_TONES = ["hadir", "terlambat", "izin", "sakit", "alpha", "other", "holiday", "off", "pending", "unclosed", "none"] as const satisfies readonly CellTone[];

const CODE_TONE: Readonly<Record<Exclude<RecapCode, "K">, CellTone>> = { H: "hadir", T: "terlambat", I: "izin", S: "sakit", A: "alpha" };

export interface CellDisplay {
  readonly text: string;
  readonly tone: CellTone;
  /** false = belum final (hari berjalan / belum ditutup): ditampilkan abu-abu atau "?". */
  readonly final: boolean;
}

/**
 * Aturan berurutan. Ada kode: OPEN -> abu-abu (tidak dihitung); K -> kelas lain; selain itu warna status (hari
 * belum ditutup tetap final). Kosong: libur -> "L"; non-sekolah / di luar semester -> kosong; OPEN -> abu-abu;
 * belum ditutup -> "?" (alpa otomatis bisa bertambah); hari sekolah tertutup -> "–" (tidak wajib absen).
 */
export function cellDisplay(day: MonthlyRecapDay, code: RecapCode | null): CellDisplay {
  if (code !== null) {
    if (day.closure === "OPEN") return { text: code, tone: "pending", final: false };
    return { text: code, tone: code === "K" ? "other" : CODE_TONE[code], final: true };
  }
  if (day.reason === "HOLIDAY") return { text: "L", tone: "holiday", final: true };
  if (day.reason !== "SCHOOL_DAY") return { text: "", tone: "off", final: true };
  if (day.closure === "OPEN") return { text: "", tone: "pending", final: false };
  if (day.closure === "UNCLOSED") return { text: "?", tone: "unclosed", final: false };
  return { text: "–", tone: "none", final: true };
}

/** Warna sel (= token --att-<tone>-soft / -ink di src/styles/charts.css; dijaga test). */
export const RECAP_TONE_COLORS: Readonly<Record<CellTone, { readonly fill: string; readonly ink: string }>> = {
  hadir: { fill: "#dcf2e9", ink: "#0b5a3f" },
  terlambat: { fill: "#fbefd8", ink: "#6b4000" },
  izin: { fill: "#e0ecfb", ink: "#1b4f91" },
  sakit: { fill: "#e9e6f7", ink: "#33287a" },
  alpha: { fill: "#fbe3e3", ink: "#8a1f1f" },
  other: { fill: "#e6eaf2", ink: "#3d4a63" },
  holiday: { fill: "#f3ecdc", ink: "#5f5235" },
  off: { fill: "#f1f2f5", ink: "#6b7080" },
  pending: { fill: "#eef0f3", ink: "#5b6070" },
  unclosed: { fill: "#fff5cc", ink: "#6e5200" },
  none: { fill: "#fafbfc", ink: "#80869a" },
};

// ----------------------------------------------------------------------------- nama sheet & berkas

const SHEET_MAX = 31;
/** Nama yang ditolak exceljs / dipakai sheet tetap (dibandingkan tanpa beda huruf besar). */
const RESERVED_SHEETS: ReadonlySet<string> = new Set(["keterangan", "history"]);

/** Nama sheet aman untuk exceljs: tanpa *?:/\[], tanpa kutip tepi, <= 31 karakter, unik tanpa beda huruf besar. */
export function sheetNameFor(name: string, used: ReadonlySet<string>): string {
  const clean = name.replace(/[*?:/\\[\]]/g, "").replace(/\s+/g, " ").trim().replace(/^'+|'+$/g, "").trim();
  const base = (clean || "Kelas").slice(0, SHEET_MAX).trim();
  const taken = (candidate: string) => used.has(candidate.toLowerCase()) || RESERVED_SHEETS.has(candidate.toLowerCase());
  if (!taken(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = `${base.slice(0, SHEET_MAX - suffix.length).trim()}${suffix}`;
    if (!taken(candidate)) return candidate;
  }
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "rekap-kehadiran-x-ipa-1-2026-09.xlsx"; semua kelas -> "rekap-kehadiran-semua-kelas-2026-09.xlsx". */
export function recapFileName(month: string, className: string | null): string {
  const part = className === null ? "semua-kelas" : slug(className) || "kelas";
  return `rekap-kehadiran-${part}-${month}.xlsx`;
}

/** Bentuk DTO tally (AttendanceTally di OpenAPI): hitungan status diratakan. */
export function toTallyDto(tally: AttendanceTally) {
  const { counts, recorded, present, presentPct, lateMinutes, lateReasons } = tally;
  return { ...counts, recorded, present, presentPct, lateMinutes, lateReasons };
}
