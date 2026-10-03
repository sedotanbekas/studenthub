import { LATE_REASON_LABELS } from "@/lib/attendance/late-reason-rules";
import type { CellDisplay, CellTone, MonthlyRecapDay } from "@/lib/attendance/monthly-recap-rules";
import type { MonthlyRecapDto } from "@/lib/attendance/monthly-recap-schemas";
import { formatLocalDate } from "@/lib/billing/format";

/** Aturan murni tab "Rekap bulanan" (A3): teks ringkasan, pemberitahuan, navigasi bulan, mode tampilan, lencana. */

type Tally = MonthlyRecapDto["totals"];
type Recap = Pick<MonthlyRecapDto, "month" | "closedThrough" | "unclosedDates" | "days">;
export type RecapMode = "grid" | "compact";

const decimal = (value: number) => String(value).replace(".", ",");

export function summaryLine(t: Tally): string {
  const pct = t.presentPct === null ? "–" : `${decimal(t.presentPct)}%`;
  const late = t.lateMinutes > 0 ? `Terlambat ${t.terlambat} (${t.lateMinutes} menit)` : `Terlambat ${t.terlambat}`;
  return `Kehadiran ${pct} · Hadir ${t.hadir} · ${late} · Izin ${t.izin} · Sakit ${t.sakit} · Alpa ${t.alpha}`;
}

export function recapNotices(recap: Recap): string[] {
  const first = `${recap.month}-01`;
  const notices: string[] = [];
  if (recap.closedThrough < first) notices.push("Belum ada hari yang ditutup di bulan ini.");
  else if (recap.days.some((d) => d.closure === "OPEN")) notices.push(`Data s.d. ${formatLocalDate(recap.closedThrough)}; hari berjalan belum dihitung.`);
  if (recap.unclosedDates.length) notices.push(`${recap.unclosedDates.length} hari belum ditutup (alpa otomatis) — angka bisa bertambah.`);
  return notices;
}

export function shiftRecapMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export const canGoNextMonth = (month: string, current: string): boolean => month < current;

/** Sama dengan breakpoint HP di monitor.css (max-width: 759px). */
export const defaultRecapMode = (width: number): RecapMode => (width < 760 ? "compact" : "grid");

export function resolveRecapClass(current: string, options: ReadonlyArray<{ id: string }>): string {
  return options.some((o) => o.id === current) ? current : (options[0]?.id ?? "");
}

export function otherClassBadge(others: MonthlyRecapDto["students"][number]["otherClasses"]): { text: string; title: string } | null {
  if (others.length === 0) return null;
  const named = others.filter((o) => o.id !== null).map((o) => o.name);
  if (named.length === 0) return { text: "Sebagian bulan tanpa kelas", title: "Sebagian bulan tercatat tanpa kelas" };
  return { text: "Pindah kelas", title: `Sebagian bulan tercatat di ${named.join(", ")}${named.length < others.length ? " dan tanpa kelas" : ""}` };
}

const WEEKDAY_SHORT = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"] as const;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"] as const;
/** Singkatan dua huruf (S saja ambigu: Senin/Selasa/Sabtu). */
const WEEKDAY_TINY = ["Sn", "Sl", "Rb", "Km", "Jm", "Sb", "Mg"] as const;
export const weekdayAbbr = (weekday: number): string => WEEKDAY_TINY[weekday - 1] ?? "";

const TONE_TEXT: Readonly<Record<CellTone, string>> = {
  hadir: "Hadir", terlambat: "Terlambat", izin: "Izin", sakit: "Sakit", alpha: "Alpa", other: "Tercatat di kelas lain",
  holiday: "Libur", off: "Bukan hari sekolah", pending: "", unclosed: "Hari belum ditutup — alpa otomatis bisa bertambah", none: "Tidak wajib absen",
};
const CODE_TEXT: Readonly<Record<string, string>> = { H: "Hadir", T: "Terlambat", I: "Izin", S: "Sakit", A: "Alpa", K: "Tercatat di kelas lain" };

/** Judul sel: "Sel 2 Sep 2026 · Hadir" (+ nama libur / keterangan belum dihitung). */
export function cellTitle(day: MonthlyRecapDay, shown: CellDisplay): string {
  const [y, m, d] = day.date.split("-").map(Number) as [number, number, number];
  const date = `${WEEKDAY_SHORT[day.weekday - 1]} ${d} ${MONTH_SHORT[m - 1]} ${y}`;
  if (shown.tone === "holiday") return `${date} · Libur${day.holidayName ? `: ${day.holidayName}` : ""}`;
  if (shown.tone === "pending") return `${date} · ${shown.text ? `${CODE_TEXT[shown.text]} (hari berjalan, belum dihitung)` : "Hari berjalan"}`;
  return `${date} · ${TONE_TEXT[shown.tone]}`;
}

/** Chip alasan terlambat (hanya kategori berisi) + "Belum diisi". */
export function lateReasonChips(t: Tally): Array<{ label: string; count: number }> {
  const chips = t.lateReasons.categories.filter((c) => c.count > 0).map((c) => ({ label: LATE_REASON_LABELS[c.category], count: c.count }));
  return t.lateReasons.unfilled > 0 ? [...chips, { label: "Belum diisi", count: t.lateReasons.unfilled }] : chips;
}

export const downloadedText = (className: string | null, monthLabel: string): string =>
  `Rekap ${className ?? "semua kelas"} ${monthLabel} terunduh.`;

export const DEMO_DOWNLOAD_TEXT = "Mode demo tidak mengunduh berkas. Masuk dengan akun sekolah untuk mengunduh Excel.";

/** [kode, arti, nada sel] — legenda di bawah matriks. */
export const RECAP_LEGEND: ReadonlyArray<readonly [string, string, CellTone]> = [
  ["H", "Hadir", "hadir"], ["T", "Terlambat", "terlambat"], ["I", "Izin", "izin"], ["S", "Sakit", "sakit"], ["A", "Alpa", "alpha"],
  ["K", "Tercatat di kelas lain", "other"], ["L", "Libur", "holiday"], ["?", "Belum ditutup — alpa otomatis bisa bertambah", "unclosed"],
  ["–", "Tidak wajib absen", "none"], ["", "Abu-abu = hari berjalan, belum dihitung", "pending"],
];
