import type { AttendanceSource, AttendanceStatus, LateReasonCategory } from "@prisma/client";
import { formatMinute, localParts, type LocalDate, type SchoolTz } from "@/lib/time/zone";

/**
 * Aturan murni alasan terlambat (A1, keputusan pemilik 2026-10-03). Dipakai server DAN komponen klien,
 * jadi tipe Prisma hanya `import type`. Alasan tidak pernah menahan absen: server sendiri yang
 * menentukan terlambat. "Perlu alasan" diturunkan dari baris (status/sumber/tanggal), tidak disimpan,
 * sehingga koreksi admin otomatis mengunci isian siswa.
 */

/** Kode kategori: HANYA boleh ditambah di ujung dan tidak pernah diganti nama (rekap lama harus sebanding). */
export const LATE_REASON_CATEGORIES = ["TRANSPORT", "WEATHER", "OVERSLEPT", "FAMILY", "HEALTH", "OTHER"] as const satisfies readonly LateReasonCategory[];
export type LateReasonCode = (typeof LATE_REASON_CATEGORIES)[number];

export const LATE_REASON_LABELS: Readonly<Record<LateReasonCode, string>> = {
  TRANSPORT: "Transportasi / macet",
  WEATHER: "Hujan / cuaca",
  OVERSLEPT: "Bangun kesiangan",
  FAMILY: "Keperluan keluarga",
  HEALTH: "Kurang sehat",
  OTHER: "Lainnya",
};

/** Batas keterangan (karakter = code point, sama dengan CHAR_LENGTH MariaDB). */
export const LATE_REASON_NOTE_MAX = 200;
export const LATE_REASON_OTHER_NOTE_MIN = 5;
/** Batas masukan mentah sebelum dinormalkan (spasi berlebih dibuang lebih dulu). */
export const LATE_REASON_NOTE_RAW_MAX = 400;

const NOTE_TOO_SHORT = `Tulis alasannya minimal ${LATE_REASON_OTHER_NOTE_MIN} karakter.`;
const NOTE_TOO_LONG = `Keterangan maksimal ${LATE_REASON_NOTE_MAX} karakter.`;
const CONTROL_OR_SPACE = /[\p{Cc}\s]+/gu;
/** Karakter format tak terlihat (pembalik arah U+202E, lebar-nol) dibuang: teks ini ditampilkan ke admin. */
const INVISIBLE_FORMAT = /\p{Cf}/gu;

/** Panjang dalam code point (sama dengan CHAR_LENGTH MariaDB utf8mb4); dipakai juga penghitung di UI. */
export const lateReasonNoteLength = (text: string): number => [...text].length;

/** Karakter kontrol & spasi beruntun -> satu spasi, karakter format dibuang, dipangkas; kosong -> null. */
export function normalizeLateReasonNote(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.replace(INVISIBLE_FORMAT, "").replace(CONTROL_OR_SPACE, " ").trim();
  return text === "" ? null : text;
}

/** Pesan masalah keterangan (null bila valid). Keterangan wajib hanya untuk "Lainnya". */
export function lateReasonNoteProblem(category: LateReasonCode, note: string | null): string | null {
  if (note !== null && lateReasonNoteLength(note) > LATE_REASON_NOTE_MAX) return NOTE_TOO_LONG;
  if (category === "OTHER" && (note === null || lateReasonNoteLength(note) < LATE_REASON_OTHER_NOTE_MIN)) return NOTE_TOO_SHORT;
  return null;
}

export interface LateReasonTarget {
  readonly status: AttendanceStatus;
  readonly source: AttendanceSource;
  readonly date: LocalDate;
}

/** Tanggal lokal hari ini + apakah hari sekolah sudah ditutup (menit lokal >= dayEndMinute). */
export interface LateReasonClock {
  readonly today: LocalDate;
  readonly dayClosed: boolean;
}

export const lateReasonClock = (local: { readonly ymd: LocalDate; readonly minuteOfDay: number }, dayEndMinute: number): LateReasonClock => ({
  today: local.ymd,
  dayClosed: local.minuteOfDay >= dayEndMinute,
});

export type LateReasonBlock = "NO_RECORD" | "DAY_CLOSED" | "LOCKED" | "NOT_LATE";

/**
 * Alasan hanya untuk check-in sendiri berstatus TERLAMBAT, hari ini, sebelum hari sekolah ditutup (rekap
 * bulanan menganggap hari tertutup sudah final). Urutan cek tetap: baris dicatat ulang admin (sumber ADMIN,
 * termasuk "Tidak valid" B1) -> LOCKED sebelum status, agar siswa tahu sekolah sudah mengubahnya.
 */
export function lateReasonBlock(row: LateReasonTarget | null, clock: LateReasonClock): LateReasonBlock | null {
  if (row === null || row.date !== clock.today) return "NO_RECORD";
  if (clock.dayClosed) return "DAY_CLOSED";
  if (row.source === "ADMIN") return "LOCKED";
  if (row.status !== "TERLAMBAT" || row.source !== "CHECKIN") return "NOT_LATE";
  return null;
}

export const canEditLateReason = (row: LateReasonTarget | null, clock: LateReasonClock): boolean => lateReasonBlock(row, clock) === null;

export interface LateReasonValue {
  readonly category: LateReasonCode;
  readonly note: string | null;
}

export function isSameLateReason(stored: LateReasonValue | null, next: LateReasonValue): boolean {
  return stored !== null && stored.category === next.category && stored.note === next.note;
}

export interface LateReasonColumns {
  readonly lateReasonCategory: LateReasonCode | null;
  readonly lateReasonNote: string | null;
  readonly lateReasonAt: Date | null;
}

export interface LateReasonDto {
  readonly category: LateReasonCode;
  readonly note: string | null;
  /** Jam lokal sekolah "HH:mm" saat terakhir diisi/diubah. */
  readonly timeLocal: string;
  readonly updatedAt: string;
}

export function toLateReasonDto(row: LateReasonColumns, tz: SchoolTz): LateReasonDto | null {
  if (row.lateReasonCategory === null || row.lateReasonAt === null) return null;
  return {
    category: row.lateReasonCategory,
    note: row.lateReasonNote,
    timeLocal: formatMinute(localParts(row.lateReasonAt, tz).minuteOfDay),
    updatedAt: row.lateReasonAt.toISOString(),
  };
}

export function lateReasonSavedMessage(unchanged: boolean): string {
  return unchanged ? "Alasan ini sudah tersimpan." : "Alasan tersimpan. Admin sekolah bisa membacanya.";
}

export interface LateReasonCounts {
  readonly total: number;
  readonly filled: number;
  readonly unfilled: number;
  readonly categories: Array<{ category: LateReasonCode; count: number }>;
}

export interface LateReasonGroupCount {
  readonly category: LateReasonCode | null;
  readonly source: string;
  readonly count: number;
}

/**
 * Hasil groupBy(source, lateReasonCategory) baris TERLAMBAT -> hitungan lengkap urut kanonik (kategori tanpa
 * baris = 0). Diisi = berkategori (sumber apa pun, termasuk koreksi yang tetap TERLAMBAT). Belum diisi = hanya
 * check-in sendiri tanpa alasan; TERLAMBAT yang dicatat admin tanpa alasan tidak dihitung (siswa tidak bisa mengisinya).
 */
export function countLateReasons(groups: readonly LateReasonGroupCount[]): LateReasonCounts {
  const byCategory = new Map<LateReasonCode, number>();
  let unfilled = 0;
  for (const group of groups) {
    if (group.category !== null) byCategory.set(group.category, (byCategory.get(group.category) ?? 0) + group.count);
    else if (group.source === "CHECKIN") unfilled += group.count;
  }
  const categories = LATE_REASON_CATEGORIES.map((category) => ({ category, count: byCategory.get(category) ?? 0 }));
  const filled = categories.reduce((sum, c) => sum + c.count, 0);
  return { total: filled + unfilled, filled, unfilled, categories };
}

// ----------------------------------------------------------------------------- bantuan UI

export interface LateReasonDraft {
  readonly category: LateReasonCode | null;
  readonly note: string;
}

export type LateReasonDraftState = "EMPTY" | "READY" | "INCOMPLETE";

export function lateReasonDraftState(draft: LateReasonDraft): LateReasonDraftState {
  const note = normalizeLateReasonNote(draft.note);
  if (draft.category === null) return note === null ? "EMPTY" : "INCOMPLETE";
  return lateReasonNoteProblem(draft.category, note) === null ? "READY" : "INCOMPLETE";
}

/** Body PUT dari draf; null kecuali draf siap dikirim. */
export function lateReasonBodyOf(draft: LateReasonDraft): LateReasonValue | null {
  if (draft.category === null || lateReasonDraftState(draft) !== "READY") return null;
  return { category: draft.category, note: normalizeLateReasonNote(draft.note) };
}

export interface LateReasonAttendance {
  readonly status: string;
  readonly lateReason: LateReasonDto | null;
  readonly lateReasonEditable: boolean;
}

export type LateReasonStep = "NONE" | "SHOW_SAVED" | "AUTO_SUBMIT" | "ASK";

/** Langkah setelah check-in tercatat: tampilkan tersimpan, kirim draf otomatis, atau tanya. */
export function lateReasonNextStep(attendance: LateReasonAttendance, draft: LateReasonDraft): LateReasonStep {
  if (attendance.status !== "TERLAMBAT") return "NONE";
  if (attendance.lateReason !== null) return "SHOW_SAVED";
  if (!attendance.lateReasonEditable) return "NONE";
  return lateReasonDraftState(draft) === "READY" ? "AUTO_SUBMIT" : "ASK";
}

export const lateReasonShort = (reason: { readonly category: LateReasonCode } | null): string => (reason ? LATE_REASON_LABELS[reason.category] : "");

/** "Hujan / cuaca" atau "Lainnya “Ban bocor”". */
export function lateReasonText(reason: Pick<LateReasonDto, "category" | "note">): string {
  const label = LATE_REASON_LABELS[reason.category];
  return reason.note ? `${label} “${reason.note}”` : label;
}

/** Blok alasan di detail catatan admin; null bila tidak relevan. */
export function lateReasonAdminView(row: { readonly status: string; readonly source: string; readonly lateReason: LateReasonDto | null }): { title: string; text: string } | null {
  const own = row.status === "TERLAMBAT" && row.source === "CHECKIN";
  if (row.lateReason) {
    const title = own ? "Alasan terlambat" : "Alasan terlambat (sebelum dikoreksi)";
    return { title, text: `${lateReasonText(row.lateReason)} · diisi pukul ${row.lateReason.timeLocal}` };
  }
  return own ? { title: "Alasan terlambat", text: "Belum diisi siswa." } : null;
}
