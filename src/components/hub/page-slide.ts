"use client";
import { sectionFromPath } from "@/lib/frontend/modules";
import { slideMode, traverseDirection, type SlideCapture, type SlideDirection } from "@/lib/frontend/page-slide-rules";

/**
 * Transisi geser halaman hub TANPA View Transitions API. Di Safari/WebKit, lapisan view transition
 * mengabaikan z-index dan halaman baru sempat tampil di tempat sebelum animasi mulai, sehingga dua
 * halaman tumpang tindih. Di sini: saat navigasi dimulai, isi lama (.hub-view: banner demo + halaman)
 * disalin menjadi "hantu" statis; setelah halaman baru dirender (layout effect, sebelum dilukis) hantu &
 * isi baru dianimasikan dengan CSS biasa (src/styles/transitions.css) — urutan lapisan memakai z-index
 * biasa, sama di semua browser. Listener popstate dipasang saat modul dievaluasi (sebelum listener Next)
 * agar isi lama masih utuh saat disalin ketika tombol kembali ditekan.
 */
const MOBILE = "(max-width: 960px)";
const REDUCED = "(prefers-reduced-motion: reduce)";
/** Jeda cadangan di atas durasi animasi bila animationend tidak terpicu (tab di latar, dsb.). */
const FALLBACK_EXTRA_MS = 300;

interface Pending extends SlideCapture { readonly ghost: HTMLElement | null }
interface SlideState {
  pending: Pending | null;
  rendered: string;
  direction: SlideDirection | null;
  cleanup: (() => void) | null;
  waiting: (() => void)[];
  installed: boolean;
}
interface EntryLike { readonly index: number }
interface NavigateEventLike extends Event { readonly navigationType: string; readonly destination?: EntryLike }

const STATE_KEY = "__studenthubPageSlide";

/** Disimpan di window agar tetap satu salinan walau modul dimuat ulang (HMR). */
function state(): SlideState {
  const holder = window as unknown as Record<string, SlideState | undefined>;
  holder[STATE_KEY] ??= { pending: null, rendered: location.pathname, direction: null, cleanup: null, waiting: [], installed: false };
  return holder[STATE_KEY];
}

/** Isi yang digeser: banner demo, pemilih sekolah, dan halaman (bukan salinan hantunya). */
const liveView = () => document.querySelector<HTMLElement>(".hub-view");

/** Salinan visual isi lama, dipaku di posisi layarnya (tanpa id, tidak bisa difokus/diklik). */
function ghostOf(view: HTMLElement): HTMLElement {
  const rect = view.getBoundingClientRect();
  const ghost = view.cloneNode(true) as HTMLElement;
  ghost.classList.replace("hub-view", "page-ghost");
  const fields = view.querySelectorAll<HTMLInputElement>("input, select, textarea");
  ghost.querySelectorAll<HTMLInputElement>("input, select, textarea").forEach((el, i) => { el.value = fields[i]?.value ?? el.value; });
  ghost.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  Object.assign(ghost.style, { top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${Math.max(rect.height, window.innerHeight - rect.top)}px` });
  return ghost;
}

/** Dipanggil saat navigasi dimulai (klik tautan hub, tombol kembali). */
export function capturePage(dir: SlideDirection): void {
  if (typeof window === "undefined") return;
  const s = state();
  if (matchMedia(REDUCED).matches) { s.pending = null; return; }
  const mobile = matchMedia(MOBILE).matches;
  const view = liveView();
  // Halaman yang tampil harus halaman terakhir yang dirender (bukan yang sudah diganti).
  const intact = view?.querySelector<HTMLElement>(".hub-page")?.dataset.section === sectionFromPath(s.rendered);
  s.pending = { dir, from: s.rendered, at: performance.now(), mobile, ghost: mobile && view && intact ? ghostOf(view) : null };
}

/** Navigasi terprogram tanpa animasi (mis. pengalihan ke beranda). */
export function cancelPageSlide(): void {
  if (typeof window !== "undefined") state().pending = null;
}

function finishSlide(): void {
  const s = state();
  if (!s.cleanup) return;
  s.cleanup();
  s.cleanup = null;
  delete document.documentElement.dataset.pageSlide;
  const waiting = s.waiting;
  s.waiting = [];
  waiting.forEach(callback => callback());
}

function slideDurationMs(): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--page-duration")) || 420;
}

/** Dipanggil kerangka hub setiap path berganti — dalam layout effect, sebelum halaman baru dilukis. */
export function playPageSlide(pathname: string): void {
  const s = state();
  const pending = s.pending;
  s.pending = null;
  s.rendered = pathname;
  const mode = slideMode(pending, pathname, performance.now());
  const view = liveView();
  if (!mode || !view || (mode !== "fade" && !pending?.ghost)) return;
  finishSlide(); // animasi sebelumnya yang masih berjalan diselesaikan dulu
  const ghost = mode === "fade" ? null : pending!.ghost;
  if (ghost) view.parentElement?.append(ghost);
  // .hub-view bertahan antarhalaman: membaca tata letak di sini (atribut animasi sudah dilepas) membuat
  // animasi berikutnya mulai dari awal walau arahnya sama dengan animasi yang baru diselesaikan.
  const top = view.getBoundingClientRect().top;
  // Isi lama yang tadinya tergulir tidak boleh menutupi area di atas isi baru (di balik topbar kaca):
  // potong hantu tepat di tepi atas isi baru.
  const hidden = ghost ? top - ghost.getBoundingClientRect().top : 0;
  if (ghost && hidden > 0) ghost.style.clipPath = `inset(${Math.round(hidden)}px 0 0 0)`;
  document.documentElement.dataset.pageSlide = mode;
  const onEnd = (event: AnimationEvent) => { if (event.target === view) finishSlide(); };
  view.addEventListener("animationend", onEnd);
  const timer = window.setTimeout(finishSlide, slideDurationMs() + FALLBACK_EXTRA_MS);
  s.cleanup = () => { view.removeEventListener("animationend", onEnd); window.clearTimeout(timer); ghost?.remove(); };
}

/** Jalankan setelah transisi halaman selesai (mis. membuka dialog absen); segera bila tidak ada transisi. */
export function afterPageSlide(callback: () => void): () => void {
  const s = state();
  if (!s.cleanup) { callback(); return () => {}; }
  s.waiting.push(callback);
  return () => { s.waiting = s.waiting.filter(cb => cb !== callback); };
}

function navigationApi(): (EventTarget & { currentEntry: EntryLike | null }) | undefined {
  return (window as Window & { navigation?: EventTarget & { currentEntry: EntryLike | null } }).navigation;
}

/** "navigate" terpicu sebelum "popstate": catat arah kembali/maju dari indeks entri. */
function onNavigate(event: Event): void {
  const e = event as NavigateEventLike;
  if (e.navigationType === "traverse") state().direction = traverseDirection(e.destination?.index, navigationApi()?.currentEntry?.index);
}

function onPopState(event: PopStateEvent): void {
  const s = state();
  const dir = s.direction ?? "back";
  s.direction = null;
  // Usap-kembali bawaan iOS/Android sudah beranimasi sendiri: jangan ditambah geser kedua.
  if (event.hasUAVisualTransition) { s.pending = null; return; }
  capturePage(dir);
}

function install(): void {
  if (typeof window === "undefined") return;
  const s = state();
  if (s.installed) return;
  s.installed = true;
  navigationApi()?.addEventListener("navigate", onNavigate);
  window.addEventListener("popstate", onPopState);
}
install();
