import { LATE_REASON_CATEGORIES } from "@/lib/attendance/late-reason-rules";
import { toMonthlyRecapDto } from "@/lib/attendance/monthly-recap-dto";
import { buildClassRecap, buildRecapDays, type MonthlyRecapRow } from "@/lib/attendance/monthly-recap-rules";
import type { MonthlyRecapDto } from "@/lib/attendance/monthly-recap-schemas";
import type { DayCheck } from "@/lib/calendar/rules";
import { addDays, eachDate, localParts, monthRange, type LocalDate } from "@/lib/time/zone";
import { DEMO_ROSTER, demoTodayRows } from "./demo-monitor";

/**
 * Rekap bulanan mode demo (A3): roster & kolom hari ini sama dengan peta contoh; hari sebelumnya dari hash
 * deterministik (siswa + tanggal). Hari dan total dibangun dengan builder server (buildRecapDays, buildClassRecap,
 * toMonthlyRecapDto), bukan ditulis tangan. Sekolah demo 6 hari (Minggu libur), libur HUT RI 17 Agustus.
 */

export const DEMO_RECAP_CLASSES = ["X IPA 1", "X IPA 2", "XI IPA 1", "XI IPS 2", "XII IPA 1"].map((name, i) => ({ id: `c${i}`, name }));

function dayCheck(date: LocalDate): DayCheck {
  if (date.slice(5) === "08-17") return { date, isSchoolDay: false, reason: "HOLIDAY", holidayName: "HUT RI" };
  if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0) return { date, isSchoolDay: false, reason: "DAY_OFF", holidayName: null };
  return { date, isSchoolDay: true, reason: "SCHOOL_DAY", holidayName: null };
}

/** FNV-1a 32-bit: angka stabil per (siswa, tanggal). */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** H 85% · T 6% · I 3% · S 3% · A 3%; menit terlambat 3–25; alasan bergiliran (sebagian belum diisi). */
function pastRow(studentId: string, classId: string, date: LocalDate): MonthlyRecapRow {
  const h = hash(`${studentId}|${date}`);
  const roll = h % 100;
  const base = { studentId, date, classId, lateMinutes: null, lateReason: null } as const;
  if (roll < 85) return { ...base, status: "HADIR", source: "CHECKIN" };
  if (roll < 91) {
    const pick = (h >>> 8) % (LATE_REASON_CATEGORIES.length + 2);
    return { ...base, status: "TERLAMBAT", source: "CHECKIN", lateMinutes: 3 + ((h >>> 4) % 23), lateReason: LATE_REASON_CATEGORIES[pick] ?? null };
  }
  if (roll < 94) return { ...base, status: "IZIN", source: "LEAVE" };
  if (roll < 97) return { ...base, status: "SAKIT", source: "LEAVE" };
  return { ...base, status: "ALPHA", source: "AUTO_ALPHA" };
}

export interface DemoRecapOptions {
  readonly classId: string;
  readonly month: string;
  readonly now?: Date;
}

export function demoMonthlyRecap({ classId, month, now = new Date() }: DemoRecapOptions): MonthlyRecapDto {
  const klass = DEMO_RECAP_CLASSES.find((c) => c.id === classId) ?? DEMO_RECAP_CLASSES[0]!;
  const range = monthRange(month) ?? { from: `${month}-01`, to: `${month}-01` };
  const today = localParts(now, "WIB").ymd;
  // Hari ini selalu "berjalan" di demo (sama dengan peta contoh yang tetap hidup sampai malam).
  const closed = addDays(today, -1);
  const days = buildRecapDays(eachDate(range.from, range.to).map(dayCheck), closed, []);
  const roster = DEMO_ROSTER.filter((s) => s.className === klass.name);
  const ids = new Set(roster.map((s) => s.id));
  const past = days.filter((d) => d.reason === "SCHOOL_DAY" && d.date < today).flatMap((d) => roster.map((s) => pastRow(s.id, klass.id, d.date)));
  const todayRows = range.from <= today && today <= range.to && dayCheck(today).isSchoolDay
    ? demoTodayRows(today).filter((r) => ids.has(r.studentId)).map((r): MonthlyRecapRow => ({ ...r, date: today, classId: klass.id, source: "CHECKIN" }))
    : [];
  const candidates = roster.map((s) => ({ id: s.id, name: s.name, nis: s.nis, status: "ACTIVE" as const, currentClassId: klass.id, isCurrentEligible: true }));
  const recap = buildClassRecap({ classKey: klass.id, days, closedThrough: closed, candidates, rows: [...past, ...todayRows] });
  return toMonthlyRecapDto({ month, range, closed, days, unclosed: [], klass, recap, classLabel: (id) => DEMO_RECAP_CLASSES.find((c) => c.id === id)?.name ?? "Tanpa kelas" });
}
