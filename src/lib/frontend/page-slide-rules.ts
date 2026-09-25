import { scrollKey as pageKey } from "./scroll-memory-rules";

/**
 * Aturan murni transisi geser halaman hub (tanpa DOM): kapan halaman baru beranimasi, arahnya, dan
 * klik mana yang dihitung. Dua jenis perpindahan:
 *   - "tab": antarhalaman utama lewat bottom nav / laci Menu — halaman lama & baru bergeser bersebelahan,
 *     arahnya mengikuti posisi tab (tujuan di kanan = masuk dari kanan);
 *   - "push": halaman di dalam halaman utama (ubin, notifikasi, tombol kembali) — ala iOS, masuk menutupi
 *     dari kanan, kembali membuka ke kanan.
 * Pelaksana DOM-nya: src/components/hub/page-slide.ts.
 */
export type SlideDirection = "forward" | "back";
export type SlideKind = "push" | "tab";
export type SlideMode = SlideDirection | "tab-forward" | "tab-back" | "fade";
/** Jenis langkah terakhir antara dua halaman (kunci = pasangan path tanpa urutan). */
export type SlideSteps = Readonly<Record<string, SlideKind>>;

/** Tangkapan halaman lama saat navigasi dimulai. */
export interface SlideCapture {
  readonly dir: SlideDirection;
  readonly kind: SlideKind;
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
  if (!capture.mobile) return "fade";
  return capture.kind === "tab" ? `tab-${capture.dir}` : capture.dir;
}

/** Posisi halaman di bottom nav (`tabs` = href tab berurutan); halaman lain berada di tombol Menu (paling kanan). */
export function tabPosition(path: string, tabs: readonly string[]): number {
  const index = tabs.indexOf(pageKey(path));
  return index === -1 ? tabs.length : index;
}

/** Arah pindah antarhalaman utama: tujuan di kanan (atau sama-sama di Menu) = "forward", di kiri = "back". */
export function tabDirection(from: string, to: string, tabs: readonly string[]): SlideDirection {
  return tabPosition(to, tabs) < tabPosition(from, tabs) ? "back" : "forward";
}

const stepKey = (a: string, b: string) => [pageKey(a), pageKey(b)].sort().join(" ");

/** Catat jenis langkah dari -> ke (salinan baru); dipakai tombol kembali/maju untuk membalik langkah itu. */
export function rememberStep(steps: SlideSteps, from: string, to: string, kind: SlideKind): SlideSteps {
  return { ...steps, [stepKey(from, to)]: kind };
}

/** Jenis langkah kembali/maju: jenis saat langkah itu dibuat; tak dikenal -> antarhalaman bottom nav = tab, lainnya push. */
export function traverseKind(steps: SlideSteps, from: string, to: string, tabs: readonly string[]): SlideKind {
  const known = steps[stepKey(from, to)];
  if (known) return known;
  return tabPosition(from, tabs) < tabs.length && tabPosition(to, tabs) < tabs.length ? "tab" : "push";
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
