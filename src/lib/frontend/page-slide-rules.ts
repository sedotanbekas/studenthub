/**
 * Aturan murni transisi geser halaman hub (tanpa DOM): kapan halaman baru beranimasi, arahnya, dan
 * klik mana yang dihitung. Pelaksana DOM-nya: src/components/hub/page-slide.ts.
 */
export type SlideDirection = "forward" | "back";
export type SlideMode = SlideDirection | "fade";

/** Tangkapan halaman lama saat navigasi dimulai. */
export interface SlideCapture {
  readonly dir: SlideDirection;
  /** Path halaman yang sedang tampil saat navigasi dimulai. */
  readonly from: string;
  /** performance.now() saat tangkapan dibuat. */
  readonly at: number;
  /** Layar HP/tablet (geser) atau layar lebar (pudar). */
  readonly mobile: boolean;
}

/** Tangkapan yang tidak segera diikuti pergantian halaman (mis. tautan ke halaman yang sama) diabaikan. */
export const SLIDE_STALE_MS = 10_000;

/** Mode animasi untuk halaman yang baru dirender; null = tanpa animasi. */
export function slideMode(capture: SlideCapture | null, pathname: string, now: number): SlideMode | null {
  if (!capture || capture.from === pathname || now - capture.at > SLIDE_STALE_MS) return null;
  return capture.mobile ? capture.dir : "fade";
}

/** Tautan ke beranda = kembali (kiri ke kanan); selain itu masuk halaman (kanan ke kiri). */
export function linkDirection(href: string): SlideDirection {
  const path = href.split(/[?#]/)[0];
  return path === "/hub" || path === "/hub/" ? "back" : "forward";
}

/** Arah tombol kembali/maju dari indeks entri Navigation API; tanpa info (browser lama) dianggap kembali. */
export function traverseDirection(destinationIndex: number | undefined, currentIndex: number | undefined): SlideDirection {
  return destinationIndex !== undefined && currentIndex !== undefined && destinationIndex > currentIndex ? "forward" : "back";
}

interface ClickLike {
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly defaultPrevented: boolean;
}

/** Hanya klik kiri biasa yang berpindah halaman di tab ini (bukan buka tab baru). */
export function isPlainClick(event: ClickLike): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.defaultPrevented;
}
