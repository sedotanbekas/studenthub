import { BANK_ACCOUNT_NUMBER_PATTERN, GEOFENCE_RADIUS_MAX_M, GEOFENCE_RADIUS_MIN_M, INDONESIA_BOUNDS, NPSN_PATTERN } from "@/lib/schools/rules";
import type { EducationLevel } from "@/lib/schools/education-level";
import type { LocalDate, SchoolTz } from "@/lib/time/zone";
import { dateText } from "./academics-rules";

/**
 * Aturan murni wizard Fase 3 (impor siswa, tagihan SPP massal, rapor semester, daftarkan sekolah): validasi
 * instan dan kalimat sebab-akibat singkat. Validasi akhir tetap di server; pesan galat server ditampilkan apa adanya.
 */

// ----------------------------------------------------------------------------- Impor siswa
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;

export function importFileProblem(file: { name: string; size: number }): string | null {
  if (!/\.(xlsx|csv)$/i.test(file.name)) return "Pilih berkas .xlsx atau .csv (unduh templatnya di langkah 1).";
  if (file.size > IMPORT_MAX_BYTES) return "Berkas lebih dari 2 MB. Bagi menjadi beberapa berkas (maks. 1.000 baris per berkas).";
  return null;
}

export interface ImportRow { readonly row: number; readonly nisn: string | null; readonly name: string | null; readonly errors: readonly string[]; readonly warnings: readonly string[] }
export interface ImportReport { readonly totalRows: number; readonly validRows: number; readonly errorRows: number; readonly warningRows: number; readonly rows: readonly ImportRow[] }

export function importSummary(report: ImportReport): { canSave: boolean; tone: "success" | "info" | "warning"; text: string } {
  const warn = report.warningRows > 0 ? `, ${report.warningRows} berperingatan` : "";
  if (report.errorRows > 0) return { canSave: false, tone: "warning", text: `${report.errorRows} baris bermasalah: perbaiki di Excel lalu unggah ulang. ${report.validRows} baris siap${warn}.` };
  if (report.warningRows > 0) return { canSave: true, tone: "info", text: `${report.validRows} baris siap disimpan${warn} (tetap bisa disimpan; baca peringatannya).` };
  return { canSave: true, tone: "success", text: `Semua ${report.totalRows} baris siap disimpan.` };
}

/** Baris bergalat dulu, lalu berperingatan (urut nomor baris Excel). */
export function problemRows(report: ImportReport): ImportRow[] {
  const errors = report.rows.filter((row) => row.errors.length > 0);
  const warnings = report.rows.filter((row) => row.errors.length === 0 && row.warnings.length > 0);
  return [...errors, ...warnings];
}

export interface Credential { readonly row: number; readonly nisn: string; readonly nis: string; readonly name: string; readonly className: string | null; readonly temporaryPassword: string }

const csvCell = (value: string | number | null): string => {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
/** Teks dari berkas unggahan (NIS, nama, kelas): awalan rumus diberi ' agar Excel menampilkannya sebagai teks. */
const plainText = (value: string | null): string | null => (value && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value);

/** CSV kata sandi awal (BOM agar Excel membaca UTF-8). Kata sandi hanya tampil sekali di server. */
export function credentialsCsv(credentials: readonly Credential[]): string {
  const header = ["Baris", "NISN", "NIS", "Nama", "Kelas", "Kata sandi sementara"].join(",");
  const lines = credentials.map((c) => [c.row, c.nisn, plainText(c.nis), plainText(c.name), plainText(c.className), c.temporaryPassword].map(csvCell).join(","));
  return `﻿${[header, ...lines].join("\r\n")}\r\n`;
}

// ----------------------------------------------------------------------------- Tagihan SPP massal
export const MONTH_NAMES = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"] as const;

export const defaultBillingPeriod = (today: LocalDate): { periodYear: number; periodMonth: number } => ({ periodYear: Number(today.slice(0, 4)), periodMonth: Number(today.slice(5, 7)) });
export const defaultInvoiceTitle = (year: number, month: number): string => `SPP ${MONTH_NAMES[month - 1] ?? ""} ${year}`;
/** Jatuh tempo bawaan tanggal 10 bulan tagihan. */
export const defaultDueDate = (year: number, month: number): LocalDate => `${year}-${String(month).padStart(2, "0")}-10`;

export type BulkScopeKind = "SCHOOL" | "CLASSES" | "STUDENTS";
export type BulkScope = { type: "SCHOOL" } | { type: "CLASSES"; classIds: string[] } | { type: "STUDENTS"; studentIds: string[] };

export function bulkScopeBody(kind: BulkScopeKind, classIds: readonly string[], studentIds: readonly string[]): { scope?: BulkScope; problem?: string } {
  if (kind === "SCHOOL") return { scope: { type: "SCHOOL" } };
  if (kind === "CLASSES") return classIds.length ? { scope: { type: "CLASSES", classIds: [...classIds] } } : { problem: "Pilih minimal satu kelas." };
  return studentIds.length ? { scope: { type: "STUDENTS", studentIds: [...studentIds] } } : { problem: "Pilih minimal satu siswa." };
}

const SKIP_TEXT: ReadonlyArray<readonly [string, string]> = [
  ["ALREADY_BILLED", "sudah punya tagihan periode ini"],
  ["EXEMPT", "bebas SPP (nominal 0)"],
  ["NOT_ACTIVE", "bukan siswa aktif"],
  ["AMOUNT_INVALID", "nominal tidak valid"],
  ["VOIDED", "tagihan periode ini pernah dibatalkan (pulihkan bila perlu)"],
];

export function skipSummary(skipped: readonly { reason: string }[]): string[] {
  return SKIP_TEXT.flatMap(([reason, text]) => {
    const count = skipped.filter((s) => s.reason === reason).length;
    return count > 0 ? [`${count} ${text}`] : [];
  });
}

// ----------------------------------------------------------------------------- Rapor semester
export interface Readiness {
  readonly subjectCount: number;
  readonly ready: readonly { reportCardId: string; studentId: string }[];
  readonly incomplete: readonly { reportCardId: string; studentId: string; missingSubjectIds: readonly string[] }[];
  readonly noReportCard: readonly string[];
  readonly published: readonly { reportCardId: string; studentId: string }[];
  readonly attendanceUnclosedDates: readonly string[];
}

/** Jumlah siswa yang belum bernilai per mapel (siswa tanpa rapor = belum bernilai di semua mapel). */
export function subjectProgress(readiness: Readiness, subjects: readonly { subjectId: string; name: string }[]): { subjectId: string; name: string; missing: number }[] {
  return subjects.map(({ subjectId, name }) => ({
    subjectId, name, missing: readiness.incomplete.filter((card) => card.missingSubjectIds.includes(subjectId)).length + readiness.noReportCard.length,
  }));
}

export function publishPlan(readiness: Readiness): { studentIds: string[]; blocked: string | null; note: string } {
  const studentIds = readiness.ready.map((card) => card.studentId);
  const pending = readiness.incomplete.length + readiness.noReportCard.length;
  const published = readiness.published.length;
  const rest = [pending ? `${pending} siswa belum lengkap nilainya` : "", published ? `${published} sudah terbit` : ""].filter(Boolean).join("; ");
  const note = `${studentIds.length} rapor siap terbit.${rest ? ` ${rest}.` : ""}`;
  if (readiness.attendanceUnclosedDates.length > 0) {
    const dates = readiness.attendanceUnclosedDates.map(dateText).join(", ");
    return { studentIds, note, blocked: `Absensi tanggal ${dates} belum ditutup, jadi rekap kehadiran belum final. Rapor bisa diterbitkan setelah hari itu ditutup.` };
  }
  return { studentIds, note, blocked: studentIds.length ? null : "Belum ada rapor yang lengkap untuk diterbitkan." };
}

// ----------------------------------------------------------------------------- Daftarkan sekolah
/** Zona waktu dari kode provinsi Kemendagri (bisa diubah manual). */
export function timezoneForProvince(provinceCode: string): SchoolTz {
  const code = Number(provinceCode);
  if (code >= 81) return "WIT";
  if ((code >= 51 && code <= 53) || (code >= 63 && code <= 65) || (code >= 71 && code <= 76)) return "WITA";
  return "WIB";
}

/** Ibu kota (atau kota terbesar) tiap provinsi: data wilayah tidak memuat koordinat, jadi peta melompat ke sini. */
const PROVINCE_CENTERS: Readonly<Record<string, readonly [number, number]>> = {
  "11": [5.55, 95.32], "12": [3.59, 98.67], "13": [-0.95, 100.35], "14": [0.51, 101.45], "15": [-1.61, 103.61],
  "16": [-2.98, 104.76], "17": [-3.8, 102.27], "18": [-5.43, 105.26], "19": [-2.13, 106.11], "21": [0.92, 104.45],
  "31": [-6.2, 106.82], "32": [-6.92, 107.61], "33": [-6.99, 110.42], "34": [-7.8, 110.36], "35": [-7.25, 112.75],
  "36": [-6.12, 106.15], "51": [-8.65, 115.22], "52": [-8.58, 116.12], "53": [-10.18, 123.61], "61": [-0.03, 109.33],
  "62": [-2.21, 113.92], "63": [-3.32, 114.59], "64": [-0.5, 117.15], "65": [2.84, 117.37], "71": [1.47, 124.84],
  "72": [-0.9, 119.87], "73": [-5.15, 119.43], "74": [-3.97, 122.51], "75": [0.54, 123.06], "76": [-2.68, 118.89],
  "81": [-3.7, 128.18], "82": [0.79, 127.38], "91": [-2.53, 140.72], "92": [-0.86, 134.06], "93": [-8.49, 140.4],
  "94": [-3.37, 135.5], "95": [-4.1, 138.95], "96": [-0.88, 131.25],
};

export function provinceCenter(provinceCode: string): { latitude: number; longitude: number } | null {
  const center = PROVINCE_CENTERS[provinceCode];
  return center ? { latitude: center[0], longitude: center[1] } : null;
}

export function identityProblem(input: { name: string; npsn: string; educationLevel: EducationLevel | null }): string | null {
  const name = input.name.trim();
  if (name.length < 3 || name.length > 150) return "Nama sekolah 3–150 karakter.";
  if (input.npsn.trim() && !NPSN_PATTERN.test(input.npsn.trim())) return "NPSN harus 8 digit angka (boleh dikosongkan).";
  return input.educationLevel ? null : "Pilih jenjang sekolah.";
}

export function locationProblem(input: { latitude: number; longitude: number; radiusM: number; provinceCode: string; cityCode: string }): string | null {
  if (!input.provinceCode || !input.cityCode) return "Pilih provinsi dan kabupaten/kota.";
  const { latMin, latMax, lngMin, lngMax } = INDONESIA_BOUNDS;
  if (!(input.latitude >= latMin && input.latitude <= latMax && input.longitude >= lngMin && input.longitude <= lngMax)) return "Titik lokasi harus di wilayah Indonesia. Klik peta di lokasi sekolah.";
  if (!(input.radiusM >= GEOFENCE_RADIUS_MIN_M && input.radiusM <= GEOFENCE_RADIUS_MAX_M)) return `Radius area sekolah ${GEOFENCE_RADIUS_MIN_M}–${GEOFENCE_RADIUS_MAX_M} meter.`;
  return null;
}

export function bankProblem(input: { bankName: string; bankAccountNumber: string; bankAccountHolder: string }): string | null {
  const values = [input.bankName, input.bankAccountNumber, input.bankAccountHolder].map((v) => v.trim());
  if (values.every((v) => !v)) return null;
  if (values.some((v) => !v)) return "Isi nama bank, nomor rekening, dan pemilik rekening semua, atau kosongkan semua.";
  return BANK_ACCOUNT_NUMBER_PATTERN.test(values[1]!) ? null : "Nomor rekening 5–30 digit angka.";
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function adminProblem(input: { name: string; email: string; hasNpsn: boolean }): string | null {
  if (input.name.trim().length < 2) return "Isi nama admin utama.";
  const email = input.email.trim();
  if (email && !EMAIL_PATTERN.test(email)) return "Format email tidak valid.";
  return email || input.hasNpsn ? null : "Sekolah tanpa NPSN: admin utama wajib punya email untuk masuk.";
}

export const loginHint = (input: { npsn: string | null; email: string | null }): string => (input.npsn ? `Masuk dengan NPSN ${input.npsn}` : `Masuk dengan email ${input.email ?? ""}`);
