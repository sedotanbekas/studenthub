import { isMobileBrowserAgent } from "@/lib/auth/device";
import { TZ_IANA } from "@/lib/time/zone";

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
  readonly window: { readonly opensAt: string; readonly lateAfter: string; readonly closesAt: string; readonly state: string };
  readonly record: { readonly status: string; readonly checkInTimeLocal: string | null; readonly lateMinutes: number | null } | null;
  readonly canCheckIn: boolean;
  readonly blockReason: string | null;
}
export interface Headline {
  readonly tone: "action" | "success" | "warning" | "neutral";
  readonly title: string;
  readonly note: string;
}

const RECORD_NOTES: Record<string, string> = { IZIN: "Tercatat izin.", SAKIT: "Tercatat sakit.", ALPHA: "Tercatat alpa." };

function recordHeadline(record: NonNullable<TodayView["record"]>): Headline {
  const at = record.checkInTimeLocal ? `Sudah absen pukul ${record.checkInTimeLocal}` : "Kehadiran sudah tercatat";
  if (record.status === "HADIR") return { tone: "success", title: at, note: "Tercatat hadir tepat waktu." };
  if (record.status === "TERLAMBAT") return { tone: "warning", title: at, note: `Tercatat terlambat ${record.lateMinutes ?? 0} menit.` };
  return { tone: "neutral", title: "Kehadiran sudah tercatat", note: RECORD_NOTES[record.status] ?? "Dicatat oleh sekolah." };
}

export function todayHeadline(today: TodayView): Headline {
  const { window } = today;
  if (today.record && today.blockReason !== null) return recordHeadline(today.record);
  if (!today.schoolDay.isSchoolDay) {
    const title = today.schoolDay.holidayName ? `Libur: ${today.schoolDay.holidayName}` : "Bukan hari sekolah";
    return { tone: "neutral", title, note: "Tidak ada absensi hari ini." };
  }
  if (today.blockReason === "CHECKIN_NOT_OPEN") return { tone: "neutral", title: "Absensi belum dibuka", note: `Absen dibuka pukul ${window.opensAt}.` };
  if (today.blockReason === "CHECKIN_CLOSED") return { tone: "neutral", title: "Absensi sudah ditutup", note: `Absensi ditutup pukul ${window.closesAt}.` };
  return { tone: "action", title: "Kamu belum absen", note: `Absen dibuka ${window.opensAt}–${window.closesAt}. Tepat waktu sampai ${window.lateAfter}.` };
}
