import { scrollKey } from "./scroll-memory-rules";

/**
 * Aturan murni splash screen hub (tanpa DOM nyata). Splash tampil HANYA untuk pengguna yang sudah masuk
 * (akun atau demo) — tamu langsung melihat halaman masuk tanpa jeda (keputusan pemilik 2026-09-29, demi
 * PageSpeed 100):
 * - situs dibuka lagi / kembali ke tab setelah pergi > 5 menit (walau lebih 1 detik saja);
 * - menekan Masuk / Coba demo (1 tirai dari tombol -> 2 logo -> 3 masker logo menyingkap beranda);
 * - keluar = kebalikannya (3 masker menutup jadi logo -> 2 logo -> 1 tirai menyusut ke tombol Masuk).
 * Pelaksana DOM: src/components/hub/splash.ts. Keputusan saat halaman dimuat dijalankan SEBELUM
 * lukisan pertama oleh skrip boot (splashBootScript) di app/hub/layout.tsx, agar halaman tidak sempat
 * berkedip tampil sebelum splash menutupinya.
 */
export const PRESENCE_KEY = "studenthub_presence";
export const RESUME_KEY = "studenthub_resume";
/** Kembali setelah pergi LEBIH dari ini -> splash tampil lagi. */
export const AWAY_MS = 5 * 60_000;
/** Catatan waktu di masa depan melebihi ini = jam perangkat diubah (dianggap sudah lama pergi). */
const FUTURE_SLACK_MS = 60_000;
/** Halaman terakhir dilanjutkan selama sesi web masih mungkin hidup (30 hari). */
export const RESUME_MAX_AGE_MS = 30 * 24 * 3_600_000;
/**
 * Durasi (ms). intro = logo mekar + rumbai toga berayun + wordmark; wipe = tirai melingkar dari tombol
 * (keluar: menyusut ke tombol Masuk); reveal = logo menjadi masker yang membesar; close = cermin reveal
 * (lubang logo menyempit menutup halaman); hold = jeda logo utuh saat keluar. Total animasi + transisi
 * <= 1 detik. holdMax = batas menunggu data sebelum masker tetap dibuka.
 */
export const SPLASH_MS = { intro: 540, wipe: 420, reveal: 460, close: 460, hold: 120, holdMax: 8000 } as const;
/**
 * Geometri tanda "S + toga" pada kanvas splash persegi (public/brand/splash-*.webp), sebagai pecahan
 * sisi kanvas — dihasilkan scripts/brand-assets.mjs. MARK_ORIGIN = titik terdalam siluet (pusat zoom
 * masker, diletakkan di tengah layar); MARK_INSCRIBED = jari-jari lingkaran dalamnya, dibulatkan ke
 * bawah untuk tepi antialias. Salin juga ke src/styles/splash.css (--splash-ox/--splash-oy).
 */
export const MARK_ORIGIN = { x: 0.4318, y: 0.3833 } as const;
export const MARK_INSCRIBED = 0.29;

export interface SplashTint { readonly a: string; readonly b: string; readonly ink: string; readonly glow: string }
export interface Presence { readonly seenAt: number; readonly signedIn: boolean; readonly tint: SplashTint | null }
export interface ResumeRecord { readonly userId: string; readonly path: string; readonly y: number; readonly at: number }
export interface ResumeContext { readonly userId: string; readonly pathname: string; readonly now: number; readonly allowed: (path: string) => boolean }

const HEX = /^#[0-9a-fA-F]{6}$/;
/** Hanya path bagian hub: /hub atau /hub/<kunci-bagian> (tanpa query, host, atau segmen lain). */
const HUB_PATH = /^\/hub(?:\/[a-z][a-z0-9-]{0,40})?$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

/** Kembali ke tab/aplikasi yang terbuka: splash hanya bila sedang masuk dan pergi terlalu lama. */
export function returnSplashDue(signedIn: boolean, seenAt: number | null | undefined, now: number): boolean {
  return signedIn && awayTooLong(seenAt, now);
}

/** Pergi terlalu lama: > AWAY_MS sejak terakhir terlihat, belum pernah tercatat, atau catatan tak masuk akal. */
export function awayTooLong(seenAt: number | null | undefined, now: number): boolean {
  if (typeof seenAt !== "number" || !Number.isFinite(seenAt)) return true;
  return now - seenAt > AWAY_MS || seenAt - now > FUTURE_SLACK_MS;
}

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function parseTint(value: unknown): SplashTint | null {
  if (!value || typeof value !== "object") return null;
  const { a, b, ink, glow } = value as Record<string, unknown>;
  return isHexColor(a) && isHexColor(b) && isHexColor(ink) && isHexColor(glow) ? { a, b, ink, glow } : null;
}

export function parsePresence(raw: string | null): Presence | null {
  const value = parseJson(raw);
  if (!value || typeof value.seenAt !== "number" || !Number.isFinite(value.seenAt) || typeof value.signedIn !== "boolean") return null;
  return { seenAt: value.seenAt, signedIn: value.signedIn, tint: parseTint(value.tint) };
}

export function parseResume(raw: string | null): ResumeRecord | null {
  const value = parseJson(raw);
  if (!value || typeof value.userId !== "string" || !value.userId || typeof value.path !== "string" || !HUB_PATH.test(value.path)) return null;
  if (typeof value.at !== "number" || !Number.isFinite(value.at)) return null;
  const y = typeof value.y === "number" && Number.isFinite(value.y) ? Math.max(0, Math.round(value.y)) : 0;
  return { userId: value.userId, path: value.path, y, at: value.at };
}

/**
 * Halaman yang dilanjutkan saat identitas akun diketahui (situs dibuka / login ulang): hanya milik akun
 * yang sama, belum kedaluwarsa, dan bagian itu boleh untuk perannya. Masuk lewat pintu utama (/hub) ->
 * halaman terakhir; memuat ulang halaman yang sama -> posisi gulirnya; tautan langsung ke halaman lain
 * dihormati (tidak dialihkan).
 */
export function resumePlan(record: ResumeRecord | null, ctx: ResumeContext): { path: string; y: number } | null {
  if (!record || record.userId !== ctx.userId || ctx.now - record.at > RESUME_MAX_AGE_MS || !ctx.allowed(record.path)) return null;
  const current = scrollKey(ctx.pathname);
  return current === "/hub" || current === record.path ? { path: record.path, y: record.y } : null;
}

/** Skala akhir masker agar lubang logo (kanvas `size` px, pusat zoom di tengah layar) menutup layar w x h. */
/**
 * `inscribed` = jari-jari lingkaran dalam siluet (bawaan tanda "S"; logo unggahan membawa geometrinya sendiri,
 * src/lib/app-settings/icon-rules.ts). Dijepit >= 0.04 agar logo sangat tipis tidak memicu skala raksasa; tirai
 * tetap memudar di akhir zoom.
 */
export function revealZoom(width: number, height: number, size: number, inscribed: number = MARK_INSCRIBED): number {
  if (!(size > 0)) return 2;
  const radius = Number.isFinite(inscribed) ? Math.max(0.04, inscribed) : MARK_INSCRIBED;
  return Math.max(2, Math.ceil(Math.hypot(width, height) / 2 / (size * radius)) + 1);
}

/** Sisa waktu intro sebelum masker boleh dibuka (0 = segera). */
export function revealDelay(startedAt: number, now: number, minMs: number): number {
  return Number.isFinite(startedAt) ? Math.max(0, minMs - (now - startedAt)) : 0;
}

interface BootStorage { getItem(key: string): string | null }
interface BootRoot { dataset: Record<string, string | undefined>; style: { setProperty(name: string, value: string): void } }

/**
 * Keputusan splash saat halaman dimuat, dijalankan sebagai <script> sebaris sebelum lukisan pertama.
 * WAJIB mandiri (tanpa impor, konstanta modul, atau fungsi bertetangga) karena diserialisasi lewat
 * toString(); logikanya sama dengan awayTooLong/parsePresence (diuji berdampingan).
 */
export function splashBoot(storage: BootStorage, root: BootRoot, now: number, startedAt: number, key: string, awayMs: number): boolean {
  let record: { seenAt?: unknown; signedIn?: unknown; tint?: unknown } | null = null;
  try { record = JSON.parse(storage.getItem(key) || "null"); } catch { record = null; }
  const seenAt = record && typeof record.seenAt === "number" ? record.seenAt : NaN;
  const away = !(now - seenAt <= awayMs) || seenAt - now > 60000;
  // Tamu (belum masuk / belum pernah tercatat / penyimpanan diblokir) tidak pernah melihat splash saat membuka situs.
  if (!record || record.signedIn !== true || !away) return false;
  const tint = (record && record.tint && typeof record.tint === "object" ? record.tint : {}) as Record<string, unknown>;
  for (const name of ["a", "b", "ink", "glow"]) {
    const value = tint[name];
    if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) root.style.setProperty("--splash-" + name, value);
  }
  root.dataset.splash = "intro";
  root.dataset.splashAt = String(startedAt);
  return true;
}

/** Isi <script> boot: galat apa pun ditelan (tanpa splash, halaman tetap tampil normal). */
export function splashBootScript(): string {
  return `try{(${splashBoot.toString()})(localStorage,document.documentElement,Date.now(),performance.now(),${JSON.stringify(PRESENCE_KEY)},${AWAY_MS})}catch(e){}`;
}
