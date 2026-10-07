import type { FaceCheck } from "@/lib/attendance/anomaly-rules";
import { isMobileBrowserAgent } from "@/lib/auth/device";
import { localParts, TZ_IANA, type SchoolTz } from "@/lib/time/zone";

/**
 * Aturan murni alur absensi web (tanpa DOM): verdict deteksi wajah, pesan izin perangkat, id perangkat
 * browser, jam sekolah, dan ringkasan status hari ini. Keputusan akhir tetap di server; aturan di sini
 * hanya memandu siswa sebelum mengirim.
 */

export interface FaceBox {
  readonly score: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface FaceVerdict {
  readonly ok: boolean;
  readonly message: string;
}

/** Skor minimal deteksi agar dianggap wajah. */
const MIN_FACE_SCORE = 0.6;
/** Lebar wajah minimal terhadap lebar bingkai (wajah cukup dekat untuk selfie yang jelas). */
const MIN_FACE_WIDTH_RATIO = 0.22;
/** Titik tengah wajah harus berada di dalam batas ini (rasio bingkai). */
const CENTER_MIN = 0.2;
const CENTER_MAX = 0.8;

export function faceVerdict(faces: readonly FaceBox[], frame: { width: number; height: number }): FaceVerdict {
  const clear = faces.filter(f => f.score >= MIN_FACE_SCORE);
  if (clear.length === 0) return { ok: false, message: "Wajah belum terlihat. Hadapkan wajah ke kamera dengan cahaya cukup." };
  if (clear.length > 1) return { ok: false, message: "Terdeteksi lebih dari satu wajah. Pastikan hanya kamu yang terlihat." };
  const [only] = clear as [FaceBox];
  if (only.width / frame.width < MIN_FACE_WIDTH_RATIO) return { ok: false, message: "Dekatkan wajah ke kamera." };
  const cx = (only.x + only.width / 2) / frame.width;
  const cy = (only.y + only.height / 2) / frame.height;
  if (cx < CENTER_MIN || cx > CENTER_MAX || cy < CENTER_MIN || cy > CENTER_MAX) return { ok: false, message: "Posisikan wajah di tengah bingkai." };
  return { ok: true, message: "Wajah terdeteksi. Tahan posisi lalu ambil foto." };
}

/**
 * Deteksi wajah OPSIONAL (keputusan pemilik 2026-10-02): tombol foto tidak menunggu pendeteksi agar absen tidak
 * lama; hasilnya dikirim ke server sebagai `faceCheck` dan foto tanpa wajah terdeteksi ditandai FACE_NOT_DETECTED
 * untuk diperiksa manual oleh admin sekolah.
 */
export type DetectorState = "loading" | "ready" | "failed";
export type { FaceCheck };
export const MANUAL_REVIEW_NOTE = "Foto tetap bisa diambil; admin sekolah akan memeriksanya.";

export function faceCheckOf(detector: DetectorState, stable: boolean): FaceCheck {
  if (stable) return "DETECTED";
  return detector === "ready" ? "NOT_DETECTED" : "UNAVAILABLE";
}

export function canShoot(camera: { readonly videoReady: boolean; readonly busy: boolean }): boolean {
  return camera.videoReady && !camera.busy;
}

export function cameraHint(detector: DetectorState, verdict: FaceVerdict, stable: boolean): string {
  if (stable) return verdict.message;
  if (detector === "failed") return `Pendeteksi wajah tidak tersedia. ${MANUAL_REVIEW_NOTE}`;
  if (detector === "loading") return `Menyiapkan pendeteksi wajah… ${MANUAL_REVIEW_NOTE}`;
  return `${verdict.message} ${MANUAL_REVIEW_NOTE}`;
}

/** Kode GeolocationPositionError: 1 ditolak, 2 tidak tersedia (GPS mati), 3 waktu habis. */
export function geolocationErrorMessage(code: number): string {
  if (code === 1) return "Izin lokasi ditolak. Izinkan akses lokasi untuk situs ini di pengaturan browser, lalu coba lagi.";
  if (code === 2) return "Lokasi tidak tersedia. Nyalakan GPS / Lokasi di HP, lalu coba lagi.";
  if (code === 3) return "Pencarian lokasi terlalu lama. Pindah ke area terbuka dan pastikan GPS menyala.";
  return "Lokasi belum dapat dibaca. Nyalakan GPS lalu coba lagi.";
}

/** Nama DOMException dari getUserMedia. */
export function cameraErrorMessage(name: string): string {
  if (name === "NotAllowedError" || name === "SecurityError") return "Izin kamera ditolak. Izinkan akses kamera untuk situs ini di pengaturan browser, lalu coba lagi.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Kamera depan tidak ditemukan di perangkat ini.";
  if (name === "NotReadableError" || name === "AbortError") return "Kamera sedang dipakai aplikasi lain. Tutup aplikasi tersebut lalu coba lagi.";
  return "Kamera belum dapat dibuka. Muat ulang halaman lalu coba lagi.";
}

interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const DEVICE_KEY = "studenthub_device";

/** Id perangkat browser (stabil per browser); id lama tanpa awalan tetap dipakai agar ikatan tidak berganti. */
export function webDeviceId(storage: KeyValueStorage, uuid: () => string): string {
  const stored = storage.getItem(DEVICE_KEY);
  if (stored) return stored;
  const created = `web-${uuid()}`;
  storage.setItem(DEVICE_KEY, created);
  return created;
}

const NISN = /^\d{10}$/;

/** deviceId dikirim saat login hanya untuk siswa (NISN) dari browser HP: sesi itulah yang boleh absen. */
export function loginDeviceId(identifier: string, userAgent: string, storage: KeyValueStorage, uuid: () => string): string | undefined {
  if (!NISN.test(identifier.trim()) || !isMobileBrowserAgent(userAgent)) return undefined;
  return webDeviceId(storage, uuid);
}

/** Batas umur fix di klien (server menolak > 180 detik); sisakan jeda untuk unggah selfie. */
const CLIENT_FIX_MAX_AGE_MS = 150_000;
export function fixAgeOk(fixTimestampMs: number, nowMs: number): boolean {
  return nowMs - fixTimestampMs <= CLIENT_FIX_MAX_AGE_MS;
}

type SchoolZone = keyof typeof TZ_IANA;
const ZONE_LABELS: Record<SchoolZone, string> = { WIB: "Waktu Indonesia Barat", WITA: "Waktu Indonesia Tengah", WIT: "Waktu Indonesia Timur" };

export interface SchoolClock {
  readonly hours: string;
  readonly minutes: string;
  readonly seconds: string;
  readonly zoneLabel: string;
  readonly date: string;
}

export function schoolClock(now: Date, zone: string): SchoolClock {
  const key: SchoolZone = zone in TZ_IANA ? (zone as SchoolZone) : "WIB";
  const timeZone = TZ_IANA[key];
  const time = new Intl.DateTimeFormat("id-ID", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const date = new Intl.DateTimeFormat("id-ID", { timeZone, weekday: "short", day: "numeric", month: "short", year: "numeric" }).formatToParts(now);
  const part = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? "";
  return {
    hours: part(time, "hour"),
    minutes: part(time, "minute"),
    seconds: part(time, "second"),
    zoneLabel: ZONE_LABELS[key],
    date: `${part(date, "weekday")}, ${part(date, "day")} ${part(date, "month")} ${part(date, "year")}`,
  };
}

/** Bagian respons GET /student/attendance/today yang dibutuhkan tampilan. */
export interface TodayView {
  readonly schoolDay: { readonly isSchoolDay: boolean; readonly reason: string; readonly holidayName: string | null };
  readonly window: { readonly opensAt: string; readonly lateAfter: string; readonly closesAt: string; readonly state: string; readonly checkOutOpensAt?: string };
  readonly record: {
    readonly status: string;
    readonly checkInTimeLocal: string | null;
    readonly lateMinutes: number | null;
    /** Absen pulang (2026-10-07); tidak ada pada respons lama. */
    readonly checkOutTimeLocal?: string | null;
  } | null;
  readonly canCheckIn: boolean;
  readonly blockReason: string | null;
  readonly canCheckOut?: boolean;
  readonly checkOutBlockReason?: string | null;
  /** Mode uji absensi (sementara): jarak & jam/hari absen tidak diperiksa server. */
  readonly testMode?: boolean;
}
export interface Headline {
  readonly tone: "action" | "success" | "warning" | "neutral";
  readonly title: string;
  readonly note: string;
}

export const TEST_MODE_NOTE = "Mode uji aktif: absen bisa dari mana saja dan kapan saja. Akurasi GPS dan foto wajah tetap wajib.";
const RECORD_NOTES: Record<string, string> = { IZIN: "Tercatat izin.", SAKIT: "Tercatat sakit.", ALPHA: "Tercatat alpa." };

type TodayRecord = NonNullable<TodayView["record"]>;

const presenceText = (record: TodayRecord): string =>
  record.status === "TERLAMBAT" ? `tercatat terlambat ${record.lateMinutes ?? 0} menit` : "tercatat hadir tepat waktu";

/** Kalimat absen pulang setelah absen masuk (2026-10-07); null = tidak ada yang perlu disampaikan. */
function checkOutHeadline(today: TodayView, record: TodayRecord): Headline | null {
  const checkedInAt = record.checkInTimeLocal ? `Masuk pukul ${record.checkInTimeLocal}, ` : "";
  if (record.checkOutTimeLocal) {
    return { tone: "success", title: `Sudah pulang pukul ${record.checkOutTimeLocal}`, note: `${checkedInAt}${presenceText(record)}.` };
  }
  if (today.canCheckOut) {
    return { tone: "action", title: "Saatnya absen pulang", note: `${checkedInAt}${presenceText(record)}. Absen pulang sebelum meninggalkan sekolah.` };
  }
  return null;
}

function recordHeadline(today: TodayView, record: TodayRecord): Headline {
  const checkOut = checkOutHeadline(today, record);
  if (checkOut) return checkOut;
  const at = record.checkInTimeLocal ? `Sudah absen pukul ${record.checkInTimeLocal}` : "Kehadiran sudah tercatat";
  const opensAt = today.window.checkOutOpensAt;
  const later = today.checkOutBlockReason === "CHECKOUT_NOT_OPEN" && opensAt ? ` Absen pulang dibuka pukul ${opensAt}.` : "";
  if (record.status === "HADIR") return { tone: "success", title: at, note: `Tercatat hadir tepat waktu.${later}` };
  if (record.status === "TERLAMBAT") return { tone: "warning", title: at, note: `Tercatat terlambat ${record.lateMinutes ?? 0} menit.${later}` };
  return { tone: "neutral", title: "Kehadiran sudah tercatat", note: RECORD_NOTES[record.status] ?? "Dicatat oleh sekolah." };
}

/**
 * OUTSIDE_TERM bisa berarti libur antar-semester ATAU semester belum diatur sekolah; server tidak membedakannya,
 * jadi kalimatnya netral tetapi tetap memberi jalan keluar (hubungi admin) — bukan sekadar "bukan hari sekolah".
 */
function nonSchoolDayHeadline(day: TodayView["schoolDay"]): Headline {
  if (day.holidayName) return { tone: "neutral", title: `Libur: ${day.holidayName}`, note: "Tidak ada absensi hari ini." };
  if (day.reason === "OUTSIDE_TERM") {
    return { tone: "neutral", title: "Absensi belum tersedia", note: "Hari ini di luar masa semester. Bila seharusnya hari sekolah, hubungi admin sekolah." };
  }
  return { tone: "neutral", title: "Hari ini bukan hari sekolah", note: "Tidak ada absensi hari ini." };
}

export function todayHeadline(today: TodayView): Headline {
  const { window } = today;
  if (today.record && today.blockReason !== null) return recordHeadline(today, today.record);
  if (today.testMode && today.canCheckIn) return { tone: "action", title: "Kamu belum absen", note: TEST_MODE_NOTE };
  if (!today.schoolDay.isSchoolDay) return nonSchoolDayHeadline(today.schoolDay);
  if (today.blockReason === "CHECKIN_NOT_OPEN") return { tone: "neutral", title: "Absensi belum dibuka", note: `Absen dibuka pukul ${window.opensAt}.` };
  if (today.blockReason === "CHECKIN_CLOSED") return { tone: "neutral", title: "Absensi sudah ditutup", note: `Absensi ditutup pukul ${window.closesAt}.` };
  return { tone: "action", title: "Kamu belum absen", note: `Absen dibuka ${window.opensAt}–${window.closesAt}. Tepat waktu sampai ${window.lateAfter}.` };
}

/**
 * GPS tidak bisa "dipaksa" akurat dari browser: akurasi ditentukan perangkat (GPS, Wi-Fi, BTS). Yang bisa
 * dilakukan: minta akurasi tinggi, pantau terus, pakai fix terbaik, dan beri langkah yang tepat bila
 * lokasi masih perkiraan jaringan. Server tetap menolak fix yang kurang akurat.
 */
/** Fix akurat dipertahankan paling lama sekian ms sebelum digantikan fix yang lebih baru. */
export const FIX_KEEP_MS = 10_000;
/** Di atas angka ini lokasi hampir pasti berasal dari jaringan/IP, bukan GPS. */
export const COARSE_ACCURACY_M = 1000;
/** Akurasi yang disimulasikan pada mode demo (sekolah juga disimulasikan di dekat pengguna). */
export const DEMO_ACCURACY_M = 8;

export interface FixSample {
  readonly accuracy: number;
  readonly timestamp: number;
}

export function preferFix<T extends FixSample>(current: T | null, next: T): T {
  if (!current || next.accuracy <= current.accuracy) return next;
  return next.timestamp - current.timestamp > FIX_KEEP_MS ? next : current;
}

export type AccuracyLevel = "good" | "weak" | "coarse";
export interface AccuracyAdvice {
  readonly level: AccuracyLevel;
  readonly message: string;
}

function radiusLabel(meters: number): string {
  return meters >= 1000 ? `±${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(meters / 1000)} km` : `±${Math.round(meters)} m`;
}

function coarseMessage(radius: string, userAgent: string): string {
  if (!isMobileBrowserAgent(userAgent)) return `Lokasi ${radius} hanya perkiraan jaringan karena perangkat ini tidak memiliki GPS. Absensi harus dilakukan dari HP dengan GPS aktif.`;
  if (/iPhone|iPad|iPod/.test(userAgent)) return `Lokasi masih perkiraan kasar (${radius}). Nyalakan Lokasi Akurat: Pengaturan → Privasi & Keamanan → Layanan Lokasi → Situs Web Safari (atau Chrome) → aktifkan "Lokasi Akurat", lalu periksa ulang.`;
  return `Lokasi masih perkiraan jaringan (${radius}), belum dari GPS. Nyalakan GPS dan aktifkan "Akurasi Lokasi Google": Setelan → Lokasi → Layanan lokasi → Akurasi Lokasi Google, lalu tunggu sebentar di area terbuka.`;
}

export function accuracyAdvice(accuracyM: number, maxAccuracyM: number, userAgent: string): AccuracyAdvice {
  if (accuracyM <= maxAccuracyM) return { level: "good", message: "" };
  const radius = radiusLabel(accuracyM);
  if (accuracyM > COARSE_ACCURACY_M) return { level: "coarse", message: coarseMessage(radius, userAgent) };
  return { level: "weak", message: `Sinyal GPS masih lemah (${radius}; batas ±${maxAccuracyM} m). Pindah ke area terbuka, jauhi gedung atau atap, lalu tunggu 10–30 detik — akurasi diperbarui otomatis.` };
}

export interface PlainFix {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracy: number;
}

/** Mode demo: posisi asli dipakai, akurasinya disimulasikan agar alur demo bisa dicoba dari laptop. */
export function simulateDemoFix(fix: PlainFix): PlainFix {
  // Salin eksplisit: pada GeolocationCoordinates asli, field adalah getter di prototype (spread = kosong).
  return { latitude: fix.latitude, longitude: fix.longitude, accuracy: Math.min(fix.accuracy, DEMO_ACCURACY_M) };
}

/**
 * Mode demo: precheck disimulasikan, jadi "akan terlambat" dihitung dari jam lokal sekolah demo terhadap batas
 * tepat waktu (window.lateAfter) agar pemilih alasan terlambat (A1) bisa dicoba setelah jam masuk.
 */
export function demoWouldBeLate(today: { readonly timezone: string; readonly window: { readonly lateAfter: string } }, now: Date): boolean {
  const zone: SchoolTz = today.timezone === "WITA" || today.timezone === "WIT" ? today.timezone : "WIB";
  const [hours, minutes] = today.window.lateAfter.split(":").map(Number);
  return localParts(now, zone).minuteOfDay > (hours ?? 0) * 60 + (minutes ?? 0);
}
