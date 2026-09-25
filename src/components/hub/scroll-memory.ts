"use client";
import { rememberPosition, savedPosition, scrollKey, type ScrollPositions } from "@/lib/frontend/scroll-memory-rules";

/**
 * Ingatan posisi gulir per halaman hub. Tanpa ini setiap pindah halaman mendarat di atas: Next.js
 * menggulir halaman baru ke atas, sedangkan pemulihan gulir bawaan browser (tombol kembali) berjalan
 * SEBELUM halaman baru dirender sehingga salah sasaran. Di sini pemulihan bawaan dimatikan, posisi
 * halaman yang tampil dicatat setiap kali digulir, dan saat halaman berganti (layout effect, sebelum
 * dilukis) halaman baru digulir ke posisi terakhirnya. Isi halaman dimuat asinkron (kerangka -> data
 * API), jadi posisi tujuan dijaga setiap kali tinggi dokumen berubah sampai pengguna menyentuh/menggulir
 * sendiri atau RESTORE_WINDOW_MS habis.
 */
/** Lama posisi tujuan dijaga selagi isi halaman masih dimuat. */
const RESTORE_WINDOW_MS = 4000;
/** Tanda pengguna mengambil alih gulir; penjagaan posisi berhenti. */
const USER_INPUT = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
const REDUCED = "(prefers-reduced-motion: reduce)";
const STATE_KEY = "__studenthubScrollMemory";

interface MemoryState {
  positions: ScrollPositions;
  /** Kunci halaman yang sedang tampil. */
  current: string;
  /** Menghentikan penjagaan posisi yang sedang berjalan (null = tidak ada). */
  stopHold: (() => void) | null;
  installed: boolean;
}

/** Disimpan di window agar tetap satu salinan walau modul dimuat ulang (HMR). */
function state(): MemoryState {
  const holder = window as unknown as Record<string, MemoryState | undefined>;
  holder[STATE_KEY] ??= { positions: {}, current: scrollKey(location.pathname), stopHold: null, installed: false };
  return holder[STATE_KEY];
}

/** Selama penjagaan berjalan, posisi sementara (isi belum lengkap) tidak menimpa posisi tujuan. */
function recordScroll(): void {
  const s = state();
  if (!s.stopHold) s.positions = rememberPosition(s.positions, s.current, window.scrollY);
}

/** Jaga posisi tujuan setiap kali tinggi dokumen berubah (kerangka -> data, animasi geser). */
function holdPosition(target: number): void {
  const s = state();
  const observer = new ResizeObserver(() => window.scrollTo(0, target));
  const stop = () => {
    observer.disconnect();
    window.clearTimeout(timer);
    USER_INPUT.forEach(type => window.removeEventListener(type, stop, true));
    s.stopHold = null;
  };
  // Waktu habis: posisi yang benar-benar tercapai (halaman bisa lebih pendek) menjadi posisi halaman.
  const timer = window.setTimeout(() => { stop(); recordScroll(); }, RESTORE_WINDOW_MS);
  USER_INPUT.forEach(type => window.addEventListener(type, stop, { capture: true, passive: true }));
  observer.observe(document.body);
  s.stopHold = stop;
}

/** Dipanggil kerangka hub setiap path berganti — dalam layout effect, sebelum halaman baru dilukis. */
export function restoreScroll(pathname: string): void {
  const s = state();
  s.stopHold?.();
  s.current = scrollKey(pathname);
  const target = savedPosition(s.positions, s.current);
  window.scrollTo(0, target);
  if (target > 0) holdPosition(target);
}

/** Tautan ke halaman yang sedang dibuka (mis. tab aktif ditekan lagi): gulir ke atas, ala iOS. */
export function scrollPageToTop(): void {
  state().stopHold?.();
  window.scrollTo({ top: 0, behavior: matchMedia(REDUCED).matches ? "auto" : "smooth" });
}

/**
 * Akun/peran berganti: posisi gulir milik akun sebelumnya tidak dibawa ke akun berikutnya, dan halaman
 * yang sedang tampil (isinya kini milik akun lain, mis. ganti persona demo) kembali ke atas.
 */
export function forgetScrollPositions(): void {
  const s = state();
  s.stopHold?.();
  s.positions = {};
  window.scrollTo(0, 0);
}

function install(): void {
  if (typeof window === "undefined") return;
  const s = state();
  if (s.installed) return;
  s.installed = true;
  history.scrollRestoration = "manual";
  window.addEventListener("scroll", recordScroll, { passive: true });
}
install();
