import type { AnomalyCode } from "@/lib/attendance/anomaly-rules";
import type { MapDto } from "@/lib/attendance/monitor-schemas";
import { compositionSlices } from "@/lib/frontend/map-cluster-rules";
import { localParts, TZ_IANA, type SchoolTz } from "@/lib/time/zone";

/**
 * Aturan murni halaman kehadiran admin (peta + daftar): metadata status (label, huruf, warna),
 * penyaringan klien (status & cari), urutan jam masuk, dan format jarak/akurasi.
 */

export type MonitorData = MapDto;
export type MapPoint = MapDto["points"][number];
export type UnlocatedEntry = MapDto["unlocated"][number];
export type MapCounts = MapDto["counts"];
export type MonitorStatus = UnlocatedEntry["status"];

export const MONITOR_STATUSES = ["HADIR", "TERLAMBAT", "IZIN", "SAKIT", "ALPHA", "BELUM_ABSEN"] as const satisfies readonly MonitorStatus[];

export interface StatusMeta {
  readonly label: string;
  /** Huruf di pin/legenda agar status tidak dibedakan oleh warna saja. */
  readonly letter: string;
  /** Akhiran kelas CSS & variabel warna: `s-${tone}` / `--att-${tone}`. */
  readonly tone: string;
  readonly countKey: keyof MapCounts;
}

export const STATUS_META: Readonly<Record<MonitorStatus, StatusMeta>> = {
  HADIR: { label: "Hadir", letter: "H", tone: "hadir", countKey: "hadir" },
  TERLAMBAT: { label: "Terlambat", letter: "T", tone: "terlambat", countKey: "terlambat" },
  IZIN: { label: "Izin", letter: "I", tone: "izin", countKey: "izin" },
  SAKIT: { label: "Sakit", letter: "S", tone: "sakit", countKey: "sakit" },
  ALPHA: { label: "Alpa", letter: "A", tone: "alpha", countKey: "alpha" },
  BELUM_ABSEN: { label: "Belum absen", letter: "B", tone: "belum", countKey: "notYet" },
};

export const statusClass = (status: MonitorStatus): string => `s-${STATUS_META[status].tone}`;
export const countOf = (counts: MapCounts, status: MonitorStatus): number => counts[STATUS_META[status].countKey];
export const totalCount = (counts: MapCounts): number => MONITOR_STATUSES.reduce((sum, s) => sum + countOf(counts, s), 0);

/** Pilihan chip status (salinan baru, urutan kanonik). Kosong = semua status tampil. */
export function toggleStatus(selected: readonly MonitorStatus[], status: MonitorStatus): MonitorStatus[] {
  const next = selected.includes(status) ? selected.filter(s => s !== status) : [...selected, status];
  return MONITOR_STATUSES.filter(s => next.includes(s));
}

export function matchesQuery(entry: { readonly name: string; readonly nis: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || entry.name.toLowerCase().includes(q) || entry.nis.toLowerCase().includes(q);
}

/** Jam masuk menaik; tanpa jam di akhir; seri -> nama. */
export function compareCheckIn(a: MapPoint, b: MapPoint): number {
  if (a.checkInTimeLocal !== b.checkInTimeLocal) {
    if (a.checkInTimeLocal === null) return 1;
    if (b.checkInTimeLocal === null) return -1;
    return a.checkInTimeLocal < b.checkInTimeLocal ? -1 : 1;
  }
  return a.name.localeCompare(b.name, "id");
}

export interface MonitorFilter { readonly statuses: readonly MonitorStatus[]; readonly query: string }
export interface FilteredMonitor { readonly points: MapPoint[]; readonly unlocated: UnlocatedEntry[] }

/** Filter klien yang sama untuk peta DAN daftar; titik diurutkan jam masuk (data asli tidak diubah). */
export function filterMonitor(data: Pick<MonitorData, "points" | "unlocated">, filter: MonitorFilter): FilteredMonitor {
  const shown = (status: MonitorStatus) => filter.statuses.length === 0 || filter.statuses.includes(status);
  return {
    points: data.points.filter(p => shown(p.status) && matchesQuery(p, filter.query)).sort(compareCheckIn),
    unlocated: data.unlocated.filter(u => shown(u.status) && matchesQuery(u, filter.query)),
  };
}

export const isOutsideRadius = (point: Pick<MapPoint, "distanceM">, radiusM: number): boolean => point.distanceM !== null && point.distanceM > radiusM;

interface Span { readonly top: number; readonly bottom: number }

/**
 * Posisi gulir daftar agar baris terpilih terlihat utuh: `row` dalam koordinat konten gulir, `margin`
 * = scroll-margin baris (atas = tinggi label sticky, jadi baris tidak berhenti di bawah label).
 * null = baris sudah terlihat (tidak digeser); baris yang lebih tinggi dari tampilan -> tepi atasnya.
 */
export function scrollToReveal(row: Span, view: { readonly scrollTop: number; readonly height: number }, margin: Span): number | null {
  const top = row.top - margin.top;
  const bottom = row.bottom + margin.bottom;
  if (top < view.scrollTop) return Math.max(0, top);
  if (bottom > view.scrollTop + view.height) return Math.max(0, Math.min(top, bottom - view.height));
  return null;
}

const kilometres = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
export function formatDistance(metres: number | null): string {
  if (metres === null) return "—";
  return metres < 1000 ? `${metres} m` : `${kilometres.format(metres / 1000)} km`;
}
export const formatAccuracy = (metres: number | null): string => (metres === null ? "—" : `±${metres} m`);

const ANOMALY_SHORT_LABELS: Readonly<Record<AnomalyCode, string>> = {
  CLOCK_SKEW: "Jam HP tidak sinkron",
  DEVICE_SESSION_MISMATCH: "Perangkat beda dari saat login",
  DUPLICATE_SELFIE: "Selfie mirip sebelumnya",
  FACE_NOT_DETECTED: "Wajah tak terdeteksi — cek foto",
  GEOFENCE_TOLERANCE: "Di luar radius (toleransi GPS)",
  LOW_ACCURACY: "Akurasi GPS rendah",
  NEW_DEVICE: "Perangkat baru",
  PERFECT_ACCURACY: "Akurasi GPS terlalu sempurna",
  SHARED_DEVICE: "HP dipakai siswa lain",
  STALE_FIX: "Data lokasi agak lama",
  TEST_MODE: "Mode uji (di luar area/jam)",
  TIME_INCONSISTENT: "Waktu lokasi janggal",
  WEB_CHECKIN: "Absen lewat browser",
};

export const flagLabels = (flags: readonly AnomalyCode[]): string[] => flags.map(code => ANOMALY_SHORT_LABELS[code] ?? code);

/** Cincin komposisi status kelompok pin (CSS conic-gradient). */
export function ringGradient(statuses: readonly MonitorStatus[]): string {
  const parts = MONITOR_STATUSES.map(s => ({ key: STATUS_META[s].tone, value: statuses.filter(v => v === s).length }));
  const slices = compositionSlices(parts);
  if (!slices.length) return "conic-gradient(var(--att-belum) 0% 100%)";
  const round = (value: number) => Math.round(value * 100) / 100;
  return `conic-gradient(${slices.map(s => `var(--att-${s.key}) ${round(s.from)}% ${round(s.to)}%`).join(", ")})`;
}

const SCHOOL_ZONES: readonly SchoolTz[] = ["WIB", "WITA", "WIT"];

/** Tanggal lokal sekolah (YYYY-MM-DD); zona di luar WIB/WITA/WIT dianggap WIB. */
export function todayLocal(now: Date, timezone: string | undefined): string {
  const tz = SCHOOL_ZONES.find(z => z === timezone) ?? "WIB";
  return localParts(now, tz).ymd;
}

// ----------------------------------------------------------------------------- tinjau anomali (B1)

/** Jumlah "perlu ditinjau" di legenda = beranomali yang belum ditinjau (sama dengan antrean server). */
export const pendingReviewCount = (points: readonly Pick<MapPoint, "needsReview">[]): number => points.filter(p => p.needsReview).length;

export interface ReviewTag { readonly text: string; readonly tone: "is-danger" | "is-ok" | "is-neutral" }

/** Tag daftar/popup: Perlu ditinjau · Valid · Tidak valid (status yang berwenang: dipulihkan bila bukan ALPHA lagi). */
export function reviewTag(point: Pick<MapPoint, "needsReview" | "reviewDecision" | "status">): ReviewTag | null {
  if (point.needsReview) return { text: "Perlu ditinjau", tone: "is-danger" };
  if (point.reviewDecision === "VALID") return { text: "Valid", tone: "is-ok" };
  if (point.reviewDecision === "INVALID") return { text: point.status === "ALPHA" ? "Tidak valid" : "Tidak valid · dipulihkan", tone: "is-neutral" };
  return null;
}

export function reviewSuccessText(decision: "VALID" | "INVALID", statusChanged: boolean): string {
  if (decision === "VALID") return "Ditandai valid — keluar dari antrean Perlu ditinjau.";
  return statusChanged ? "Ditandai tidak valid — status jadi Alpa, siswa diberi tahu." : "Ditandai tidak valid — status sudah Alpa.";
}

export function reviewErrorText(code: string, message: string): string {
  if (code === "NOT_SCHOOL_DAY") return "Tanggal ini bukan hari sekolah, jadi tidak bisa dijadikan Alpa — tandai Valid bila sudah diperiksa.";
  return message;
}

/** Kode yang berarti keadaan catatan berubah: detail dimuat ulang sebelum admin memutuskan lagi. */
export const REVIEW_RELOAD_CODES: ReadonlySet<string> = new Set(["ANOMALY_ALREADY_INVALID", "ANOMALY_FLAGS_CHANGED"]);

export const INVALID_REASON_CHIPS = ["Foto bukan wajah siswa", "Wajah tidak terlihat jelas", "HP dipakai siswa lain", "Tidak berada di sekolah"] as const;

/** "3 Okt 2026 08.05" di zona sekolah (bukan zona perangkat admin). */
export function formatReviewedAt(iso: string, timezone: string | undefined): string {
  const tz = SCHOOL_ZONES.find(z => z === timezone) ?? "WIB";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: TZ_IANA[tz] }).format(new Date(iso));
}

export interface AttendanceTarget { readonly id: string; readonly name: string; readonly date: string | null }

/** Baris "Data lengkap" (harian/anomali) -> catatan kehadiran untuk dialog detail; tanpa catatan -> null. */
export function attendanceTargetOf(row: Readonly<Record<string, unknown>>, viewPath: string | undefined): AttendanceTarget | null {
  if (viewPath !== "/school/attendance/daily" && viewPath !== "/school/attendance/anomalies") return null;
  const attendance = row.attendance as { id?: unknown } | null | undefined;
  const student = row.student as { name?: unknown } | null | undefined;
  if (!attendance || typeof attendance.id !== "string") return null;
  return { id: attendance.id, name: typeof student?.name === "string" ? student.name : "Detail kehadiran", date: typeof row.date === "string" ? row.date : null };
}
