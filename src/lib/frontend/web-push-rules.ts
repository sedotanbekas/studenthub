import type { Role } from "./types";

/**
 * Aturan murni Web Push di browser (N3): jenis perangkat, kapan lembar ajakan tampil, langkah membuka blokir,
 * sinkron langganan per identitas (dari server), dan badge ikon aplikasi.
 */

export interface DeviceInfo {
  readonly ios: boolean;
  readonly iosVersion: number | null;
  readonly android: boolean;
  readonly mobile: boolean;
  readonly standalone: boolean;
}

export interface DeviceEnv {
  readonly maxTouchPoints: number;
  readonly standalone: boolean;
  readonly coarse: boolean;
  readonly width: number;
}

const MOBILE_MAX_WIDTH = 900;

function iosVersionOf(ua: string): number | null {
  const os = /OS (\d+)[_.](\d+)/.exec(ua) ?? /Version\/(\d+)\.(\d+)/.exec(ua);
  return os ? Number(os[1]) + Number(os[2]) / 100 : null;
}

/** iPadOS menyamar sebagai Macintosh: dianggap iOS bila layar sentuh. */
export function deviceInfoOf(ua: string, env: DeviceEnv): DeviceInfo {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && env.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  return { ios, iosVersion: ios ? iosVersionOf(ua) : null, android, mobile: ios || android || (env.coarse && env.width < MOBILE_MAX_WIDTH), standalone: env.standalone };
}

/** iOS 16.4+ mendukung Web Push hanya dari ikon layar utama. */
const IOS_WEB_PUSH_MIN = 16.04;

export type PromptMode = "ask" | "install-ios";

export interface PromptInput {
  readonly enabled: boolean;
  readonly demo: boolean;
  readonly restricted: boolean;
  readonly deferred: boolean;
  /** Lembar hanya di beranda dan bila tidak ada dialog lain yang terbuka. */
  readonly home: boolean;
  readonly dialogOpen: boolean;
  readonly supported: boolean;
  readonly permission: NotificationPermission | "unsupported";
  readonly device: DeviceInfo;
}

/** Lembar ajakan otomatis: hanya HP/aplikasi terpasang; diblokir TIDAK pernah otomatis (kartu Keamanan akun). */
export function promptModeOf(i: PromptInput): PromptMode | null {
  if (i.demo || i.restricted || !i.enabled || i.deferred || !i.home || i.dialogOpen) return null;
  if (!i.device.mobile && !i.device.standalone) return null;
  if (!i.supported) return i.device.ios && !i.device.standalone && (i.device.iosVersion ?? 0) >= IOS_WEB_PUSH_MIN ? "install-ios" : null;
  return i.permission === "default" ? "ask" : null;
}

/** "Nanti saja" menunda lembar 7 hari di perangkat ini (localStorage, bukan per tab). */
export const PROMPT_DEFER_DAYS = 7;
const DAY_MS = 86_400_000;

export function isPromptDeferred(stored: string | null, now: number): boolean {
  const until = stored === null ? Number.NaN : Number(stored);
  return Number.isFinite(until) && now < until;
}

export const promptDeferValue = (now: number): string => String(now + PROMPT_DEFER_DAYS * DAY_MS);

export function blockedHelpSteps(d: DeviceInfo): string[] {
  if (d.ios) return ["Buka Pengaturan iPhone, lalu Notifikasi.", "Pilih studenthub.id.", "Nyalakan Izinkan Notifikasi."];
  if (d.android) return ["Ketuk ikon di kiri alamat situs (atau ⋮ lalu Info situs).", "Pilih Izin, lalu Notifikasi.", "Pilih Izinkan, lalu muat ulang halaman."];
  return ["Klik ikon di kiri bilah alamat.", "Pada Notifikasi, pilih Izinkan.", "Muat ulang halaman."];
}

const PROMPT_TOPICS: Readonly<Record<Role, string>> = {
  STUDENT: "Kabar absen, tagihan, dan pengumuman",
  SCHOOL_ADMIN: "Pengajuan izin, bukti bayar, dan kabar sekolah",
  SPONSOR: "Status iklan dan saldo",
  SUPER_ADMIN: "Moderasi iklan, top-up, dan kabar platform",
  REGION_ADMIN: "Kabar platform untuk pemantauan wilayah",
};

export const deviceWord = (d: DeviceInfo): string => (d.mobile ? "HP-mu" : "perangkat ini");

export function promptText(role: Role, d: DeviceInfo): string {
  return `${PROMPT_TOPICS[role]} langsung muncul di ${deviceWord(d)} walau aplikasi tertutup.`;
}

export const IOS_INSTALL_STEPS: readonly string[] = [
  "Ketuk tombol Bagikan (kotak dengan panah ke atas).",
  "Pilih Tambah ke Layar Utama, lalu Tambah.",
  "Buka dari ikon baru, masuk sekali lagi, lalu aktifkan notifikasi. Setelah ini selalu buka dari ikon itu: masuk lewat Safari akan mengeluarkan aplikasi di layar utama dan mematikan notifikasinya.",
];

export function feedbackText(kind: "on" | "failed" | "dismissed" | "blocked" | "off", d: DeviceInfo): string {
  const where = d.mobile ? "HP ini" : "perangkat ini";
  if (kind === "on") return `Notifikasi aktif. Kabar baru muncul di ${where}.`;
  if (kind === "failed") return `${d.mobile ? "HP" : "Perangkat"} ini belum bisa menerima notifikasi. Coba lagi nanti.`;
  if (kind === "dismissed") return "Izin belum dipilih. Ketuk Aktifkan sekali lagi.";
  if (kind === "blocked") return "Masih diblokir. Ikuti langkah di atas, lalu coba lagi.";
  return "Notifikasi dimatikan di perangkat ini.";
}

// ----------------------------------------------------------------------------- kunci server

export function base64UrlToBytes(key: string): Uint8Array {
  const padded = key.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(key.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Langganan browser dibuat untuk kunci server yang sama? (kunci berganti -> wajib langganan ulang) */
export function sameServerKey(current: ArrayBuffer | null | undefined, expected: Uint8Array): boolean {
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === expected.length && bytes.every((b, i) => b === expected[i]);
}

// ----------------------------------------------------------------------------- sinkron per identitas

export type SyncAction = "none" | "subscribe" | "resubscribe";

export interface SyncInput {
  readonly enabled: boolean;
  readonly supported: boolean;
  readonly permission: NotificationPermission | "unsupported";
  /** Server: sesi INI punya langganan. */
  readonly subscribed: boolean;
  readonly hasBrowserSubscription: boolean;
  readonly keyMatches: boolean;
}

/**
 * Diputuskan dari server setiap identitas berganti (masuk ulang = sesi baru tanpa baris). Server belum punya baris
 * padahal browser masih berlangganan -> langganan ulang (endpoint baru, bukan mendaftarkan endpoint yang mungkin
 * sudah dijawab 410).
 */
export function syncAction(i: SyncInput): SyncAction {
  if (!i.enabled || !i.supported || i.permission !== "granted") return "none";
  if (!i.hasBrowserSubscription) return "subscribe";
  if (!i.keyMatches || !i.subscribed) return "resubscribe";
  return "none";
}

// ----------------------------------------------------------------------------- badge ikon aplikasi

export type AppBadgeAction = { readonly kind: "set"; readonly count: number } | { readonly kind: "clear" } | null;

/** Halaman = penulis kedua badge ikon (service worker menulis saat push tiba): ikut jumlah belum dibaca N1. */
export function appBadgeAction(count: number | null, i: { readonly supported: boolean; readonly permission: NotificationPermission | "unsupported" }): AppBadgeAction {
  if (!i.supported || i.permission !== "granted" || count === null) return null;
  return count > 0 ? { kind: "set", count } : { kind: "clear" };
}

/**
 * Klik notifikasi saat hub terbuka: pindah halaman lewat router; tujuan di halaman yang SAMA dimuat penuh, karena
 * `?notif=` (tandai dibaca) dan intent seperti `?absen=1` hanya dibaca saat halaman dipasang.
 */
export function navigationKind(currentPathname: string, url: string): "push" | "reload" {
  return new URL(url, "https://studenthub.invalid").pathname === currentPathname ? "reload" : "push";
}
