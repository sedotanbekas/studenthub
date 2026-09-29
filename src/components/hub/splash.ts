"use client";
import { scrollKey } from "@/lib/frontend/scroll-memory-rules";
import { PRESENCE_KEY, RESUME_KEY, SPLASH_MS, isHexColor, parsePresence, parseResume, returnSplashDue, revealDelay, revealZoom, type ResumeRecord, type SplashTint } from "@/lib/frontend/splash-rules";

/**
 * Pelaksana DOM splash screen hub. Aturan: src/lib/frontend/splash-rules.ts; tampilan:
 * splash-screen.tsx + src/styles/splash.css. Fase ditandai atribut <html data-splash>:
 * intro (logo + wordmark) | wipe (setelah login: tirai melingkar dari tombol) |
 * reveal (logo menjadi masker yang membesar dan menyingkap halaman) | leave (dibatalkan: memudar).
 * Keluar = login dibalik: close (lubang logo menyempit menutup halaman) | hold (logo utuh) |
 * unwipe (tirai menyusut ke tombol Masuk, menyingkap halaman masuk).
 * Masker baru dibuka setelah halaman tujuan siap (sesi dimuat, halaman terakhir dilanjutkan), paling
 * lambat SPLASH_MS.holdMax. "Terakhir terlihat" dicatat di localStorage (bersama semua tab) setiap
 * detak, saat tab disembunyikan, dan saat halaman ditutup; kembali setelah > 5 menit memutar splash.
 */
export type SplashView = "loading" | "login" | "app";
type SplashKind = "load" | "return" | "login" | "logout";
type SplashPhase = "intro" | "wipe" | "close" | "hold";
interface Point { readonly x: number; readonly y: number }

const REDUCED = "(prefers-reduced-motion: reduce)";
const HEARTBEAT_MS = 15_000;
const LEAVE_MS = 180;
const TINT_VARS = { a: "--splash-a", b: "--splash-b", ink: "--splash-ink", glow: "--splash-glow" } as const;
const STATE_KEY = "__studenthubSplash";
/** Gambar splash; tamu tidak melihat splash saat membuka situs, jadi gambarnya dipanaskan setelah halaman selesai dimuat. */
const SPLASH_IMAGES = ["/brand/splash-body.webp", "/brand/splash-tassel.webp", "/brand/splash-shape.webp"];
/** Tombol Masuk di halaman masuk: tujuan tirai saat keluar (asal tirai saat masuk). */
const LOGIN_BUTTON = ".login-box .button.primary";

interface SplashState {
  kind: SplashKind | null;
  /** performance.now() saat animasi (ulang) dimulai. */
  startedAt: number;
  /** Pembukaan masker sudah dijadwalkan / sedang berjalan. */
  scheduled: boolean;
  /** Splash mulai saat tab tersembunyi: animasi diulang begitu tab terlihat. */
  paused: boolean;
  timers: number[];
  view: SplashView;
  pathname: string;
  /** Halaman terakhir yang sedang dilanjutkan; masker menunggu halaman ini dirender. */
  resumeTo: string | null;
  signedIn: boolean;
  resumeUser: string | null;
  lastBeat: number;
  installed: boolean;
}

/** Disimpan di window agar tetap satu salinan walau modul dimuat ulang (HMR). */
function state(): SplashState {
  const holder = window as unknown as Record<string, SplashState | undefined>;
  holder[STATE_KEY] ??= initialState();
  return holder[STATE_KEY];
}

/** Splash dari skrip boot (sebelum lukisan pertama) diambil alih di sini. */
function initialState(): SplashState {
  const booted = root().dataset.splash === "intro";
  if (booted && !root().style.getPropertyValue(TINT_VARS.a)) applyTint(currentTint());
  return {
    kind: booted ? "load" : null, startedAt: booted ? Number(root().dataset.splashAt) : 0, scheduled: false,
    paused: booted && document.visibilityState === "hidden", timers: [], view: "loading", pathname: location.pathname,
    resumeTo: null, signedIn: false, resumeUser: null, lastBeat: Date.now(), installed: false,
  };
}

const root = () => document.documentElement;
const reduced = () => matchMedia(REDUCED).matches;
const screen = () => document.querySelector<HTMLElement>(".splash");

function later(callback: () => void, ms: number): void {
  state().timers.push(window.setTimeout(callback, ms));
}

function clearTimers(): void {
  const s = state();
  s.timers.forEach(timer => window.clearTimeout(timer));
  s.timers = [];
}

/** Warna tema yang sedang tampil (banner sekolah) — hanya bila semuanya hex sah. */
function currentTint(): SplashTint | null {
  const css = getComputedStyle(root());
  const read = (name: string) => css.getPropertyValue(name).trim().toLowerCase();
  const tint = { a: read("--banner"), b: read("--banner-2"), ink: read("--on-banner"), glow: read("--animation") };
  return isHexColor(tint.a) && isHexColor(tint.b) && isHexColor(tint.ink) && isHexColor(tint.glow) ? tint : null;
}

/** Warna splash dibekukan saat mulai: tema sekolah yang dimuat di tengah splash tidak membuatnya berkedip. */
function applyTint(tint: SplashTint | null): void {
  if (!tint) return;
  for (const [key, name] of Object.entries(TINT_VARS)) root().style.setProperty(name, tint[key as keyof SplashTint]);
}

/** Di atas dialog modal yang sedang terbuka (top layer), bila Popover API tersedia. */
function setOnTop(show: boolean): void {
  const el = screen();
  if (!el || typeof el.showPopover !== "function") return;
  try {
    const open = el.matches(":popover-open");
    if (show && !open) el.showPopover();
    if (!show && open) el.hidePopover();
  } catch { /* popover tidak didukung: tetap tampil lewat z-index */ }
}

/** Fase pembuka tiap jenis splash. */
function openingPhase(kind: SplashKind): SplashPhase {
  return kind === "login" ? "wipe" : kind === "logout" ? "close" : "intro";
}

/** Waktu minimum sejak mulai sebelum halaman tujuan disingkap. */
function minimumMs(kind: SplashKind): number {
  if (reduced()) return 0;
  return kind === "login" ? SPLASH_MS.wipe : kind === "logout" ? SPLASH_MS.close + SPLASH_MS.hold : SPLASH_MS.intro;
}

/** Skala akhir masker untuk layar ini (splash harus sudah tampil agar ukurannya terbaca). */
function setZoom(): void {
  const size = screen()?.querySelector<HTMLElement>(".splash-art")?.offsetWidth ?? 0;
  root().style.setProperty("--splash-zoom", String(revealZoom(window.innerWidth, window.innerHeight, size)));
}

/** Pasang ulang fase agar animasi CSS mulai dari awal. */
function playPhase(phase: SplashPhase): void {
  const el = root();
  delete el.dataset.splash;
  void el.offsetWidth;
  el.dataset.splash = phase;
}

function start(kind: SplashKind, onTop: boolean): void {
  const s = state();
  clearTimers();
  Object.assign(s, { kind, scheduled: false, paused: false, startedAt: performance.now() });
  root().dataset.splashKind = kind;
  playPhase(openingPhase(kind));
  if (kind === "logout") setZoom();
  if (onTop) setOnTop(true);
  armHold();
  maybeReveal();
}

/** Data belum juga siap: masker tetap dibuka setelah holdMax (selama tab terlihat). */
function armHold(): void {
  later(() => { if (document.visibilityState === "visible") reveal(); }, SPLASH_MS.holdMax);
}

function ready(s: SplashState): boolean {
  if (s.resumeTo && scrollKey(s.pathname) !== s.resumeTo) return false;
  if (s.kind === "login") return s.view === "app";
  // Keluar: tunggu halaman masuk benar-benar di /hub (router.replace selesai) agar tidak ada geser halaman di balik tirai.
  if (s.kind === "logout") return s.view === "login" && scrollKey(s.pathname) === "/hub";
  return s.view !== "loading";
}

function maybeReveal(): void {
  const s = state();
  if (!s.kind || s.scheduled || s.paused || !ready(s) || document.visibilityState === "hidden") return;
  s.scheduled = true;
  later(reveal, revealDelay(s.startedAt, performance.now(), minimumMs(s.kind)));
}

/** Logo menjadi masker: lubang berbentuk buku membesar sampai menutup layar, lalu splash dilepas. */
function reveal(): void {
  const s = state();
  if (!s.kind || root().dataset.splash === "reveal") return;
  clearTimers();
  s.scheduled = true;
  if (reduced()) { finish(); return; }
  if (s.kind === "logout") { unwipe(); return; }
  setZoom();
  root().dataset.splash = "reveal";
  later(finish, SPLASH_MS.reveal);
}

/** Langkah terakhir keluar: tirai menyusut kembali ke tombol Masuk (asal tirai saat masuk). */
function unwipe(): void {
  const target = centerOf(document.querySelector(LOGIN_BUTTON));
  if (target) {
    root().style.setProperty("--splash-x", `${Math.round(target.x)}px`);
    root().style.setProperty("--splash-y", `${Math.round(target.y)}px`);
  }
  root().dataset.splash = "unwipe";
  later(finish, SPLASH_MS.wipe);
}

function finish(): void {
  const s = state();
  clearTimers();
  Object.assign(s, { kind: null, scheduled: false, paused: false });
  const el = root();
  delete el.dataset.splash;
  delete el.dataset.splashAt;
  delete el.dataset.splashKind;
  for (const name of [...Object.values(TINT_VARS), "--splash-zoom", "--splash-x", "--splash-y"]) el.style.removeProperty(name);
  setOnTop(false);
}

/** Kerangka hub melapor keadaannya (layout effect setiap tampilan/path berganti). */
export function setSplashView(view: SplashView, pathname: string): void {
  const s = state();
  s.view = view;
  s.pathname = pathname;
  if (s.resumeTo && scrollKey(pathname) === s.resumeTo) setResumeTo(null);
  maybeReveal();
}

const resumeListeners = new Set<() => void>();

function setResumeTo(path: string | null): void {
  state().resumeTo = path;
  resumeListeners.forEach(listener => listener());
}

/**
 * Halaman terakhir sedang dilanjutkan (router.replace): masker menunggu halaman itu tampil dan kerangka
 * hub menahan beranda agar tidak sempat berkedip. Navigasi yang tak kunjung selesai dilepas setelah holdMax.
 */
export function awaitResume(path: string): void {
  const target = scrollKey(path);
  setResumeTo(target);
  window.setTimeout(() => { if (state().resumeTo === target) setResumeTo(null); }, SPLASH_MS.holdMax);
}

export function subscribeResume(listener: () => void): () => void {
  resumeListeners.add(listener);
  return () => { resumeListeners.delete(listener); };
}

export function resumePending(): boolean {
  return state().resumeTo !== null;
}

/**
 * Login berhasil: tirai warna sekolah melingkar dari tombol yang ditekan, logo mekar, lalu masker
 * menyingkap beranda. Promise selesai saat tirai menutup layar — identitas baru dipasang setelahnya
 * agar pergantian halaman tidak terlihat di luar lingkaran.
 */
export function playLoginSplash(origin: Point | null): Promise<void> {
  if (typeof window === "undefined" || reduced() || state().kind) return Promise.resolve();
  if (origin) {
    root().style.setProperty("--splash-x", `${Math.round(origin.x)}px`);
    root().style.setProperty("--splash-y", `${Math.round(origin.y)}px`);
  }
  applyTint(currentTint());
  start("login", true);
  return new Promise(resolve => window.setTimeout(resolve, SPLASH_MS.wipe));
}

/**
 * Keluar = login dibalik (3-2-1): lubang berbentuk logo menyempit dari layar penuh hingga seukuran logo
 * lalu logo terisi, logo utuh sejenak, kemudian tirai menyusut ke tombol Masuk. Promise selesai saat
 * layar tertutup — identitas dilepas setelahnya agar pergantian ke halaman masuk tidak terlihat.
 */
export function playLogoutSplash(): Promise<void> {
  if (typeof window === "undefined" || reduced() || state().kind || document.visibilityState === "hidden") return Promise.resolve();
  applyTint(currentTint());
  start("logout", true);
  later(() => { if (state().kind === "logout" && root().dataset.splash === "close") root().dataset.splash = "hold"; }, SPLASH_MS.close);
  return new Promise(resolve => window.setTimeout(resolve, SPLASH_MS.close));
}

/** Login gagal setelah tirai mulai: splash memudar tanpa membuka masker. */
export function cancelSplash(): void {
  const s = state();
  if (!s.kind) return;
  clearTimers();
  s.scheduled = true;
  if (reduced()) { finish(); return; }
  root().dataset.splash = "leave";
  later(finish, LEAVE_MS);
}

/** Titik tengah elemen (asal tirai login). */
export function centerOf(element: Element | null | undefined): Point | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function playReturnSplash(): void {
  if (state().kind || reduced()) return;
  applyTint(currentTint());
  start("return", true);
}

function readStorage(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* penyimpanan diblokir: splash tetap tampil saat situs dibuka, halaman tidak dilanjutkan */ }
}

function writePresence(): void {
  writeStorage(PRESENCE_KEY, JSON.stringify({ seenAt: Date.now(), signedIn: state().signedIn, tint: currentTint() }));
}

/** Halaman & posisi gulir yang sedang dilihat akun ini (bukan demo) — dilanjutkan saat situs dibuka lagi. */
function saveResume(): void {
  const s = state();
  const path = scrollKey(location.pathname);
  if (!s.resumeUser || s.resumeTo || !(path === "/hub" || path.startsWith("/hub/"))) return;
  const record: ResumeRecord = { userId: s.resumeUser, path, y: Math.round(window.scrollY), at: Date.now() };
  writeStorage(RESUME_KEY, JSON.stringify(record));
}

export function readResume(): ResumeRecord | null {
  return parseResume(readStorage(RESUME_KEY));
}

/** Identitas aktif: masuk (termasuk demo) untuk keputusan splash; akun sungguhan untuk halaman terakhir. */
export function trackIdentity(signedIn: boolean, resumeUser: string | null): void {
  const s = state();
  const changed = s.signedIn !== signedIn;
  s.signedIn = signedIn;
  s.resumeUser = resumeUser;
  if (changed) writePresence();
}

export function rememberCurrentPage(): void {
  saveResume();
}

/** Keluar: halaman terakhir akun ini tidak dilanjutkan lagi. */
export function forgetResume(): void {
  state().resumeUser = null;
  writeStorage(RESUME_KEY, null);
}

function onVisibility(): void {
  const s = state();
  if (document.visibilityState === "hidden") {
    if (s.kind && !s.scheduled) s.paused = true;
    writePresence();
    saveResume();
    return;
  }
  s.lastBeat = Date.now();
  if (s.kind) {
    if (s.paused) resumePaused(s, s.kind);
  } else if (returnSplashDue(s.signedIn, parsePresence(readStorage(PRESENCE_KEY))?.seenAt, Date.now())) playReturnSplash();
  writePresence();
}

/** Splash yang mulai saat tab tersembunyi diulang begitu tab terlihat (keluar: lanjut dari logo utuh). */
function resumePaused(s: SplashState, kind: SplashKind): void {
  const logout = kind === "logout";
  Object.assign(s, { paused: false, startedAt: performance.now() - (logout ? SPLASH_MS.close : 0) });
  playPhase(logout ? "hold" : openingPhase(kind));
  armHold();
  maybeReveal();
}

/** Tab terbuka tetapi perangkat tidur (timer berhenti) lebih dari 5 menit = kembali setelah pergi. */
function heartbeat(): void {
  const s = state();
  if (document.visibilityState !== "visible") return;
  const now = Date.now();
  if (returnSplashDue(s.signedIn, s.lastBeat, now)) playReturnSplash();
  s.lastBeat = now;
  writePresence();
  saveResume();
}

/** Unduh gambar splash saat peramban senggang setelah halaman dimuat (siap untuk tirai Masuk/Keluar). */
function warmSplashImages(): void {
  const warm = () => SPLASH_IMAGES.forEach(src => { const image = new Image(); image.decoding = "async"; image.src = src; });
  const idle = () => { if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(warm, { timeout: 3000 }); else setTimeout(warm, 1500); };
  if (document.readyState === "complete") idle();
  else window.addEventListener("load", idle, { once: true });
}

function install(): void {
  if (typeof window === "undefined") return;
  const s = state();
  if (s.installed) return;
  s.installed = true;
  warmSplashImages();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pageshow", event => { if (event.persisted) onVisibility(); });
  window.addEventListener("pagehide", () => { writePresence(); saveResume(); });
  window.setInterval(heartbeat, HEARTBEAT_MS);
}
install();
