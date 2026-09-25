"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Next 16.3 memulihkan riwayat (tombol kembali browser/HP) TANPA View Transition (vercel/next.js#86881),
 * sehingga halaman tidak bergeser saat "back". Di layar HP, popstate di dalam /hub dicegat lalu diulang
 * sebagai router.replace bertipe "nav-back"/"nav-forward" agar <ViewTransition> halaman bergeser searah.
 *
 * Listener dipasang saat MODUL dievaluasi (ketika hidrasi memuat komponen ini), yaitu sebelum listener
 * popstate milik Next yang dipasang di useEffect setelah hidrasi — listener pada `window` dipanggil
 * sesuai urutan pendaftaran, sehingga stopImmediatePropagation dapat melewati pemulihan bawaan Next.
 * Tidak dicegat bila: browser tanpa View Transitions, gerakan usap bawaan OS sudah beranimasi
 * (hasUAVisualTransition), pengguna memilih kurangi gerak, layar lebar, keluar dari /hub, atau
 * kerangka hub belum terpasang. Bergantung pada perilaku internal Next (penanda `__NA`): uji ulang
 * setiap upgrade Next dan hapus bila isu tersebut sudah diperbaiki.
 */
interface EntryLike { readonly index: number }
interface NavigationLike extends EventTarget { readonly currentEntry: EntryLike | null }
interface NavigateEventLike extends Event { readonly navigationType: "push" | "replace" | "reload" | "traverse"; readonly destination: EntryLike }
type Direction = "back" | "forward";
type Router = ReturnType<typeof useRouter>;
/** Disimpan di window agar tetap satu salinan walau modul dimuat ulang (HMR). */
interface ShimState { router: Router | null; committed: string; direction: Direction | null; installed: boolean }

const STATE_KEY = "__studenthubTraverse";
const HUB_PREFIX = "/hub";
const SKIP_MEDIA = "(prefers-reduced-motion: reduce), (min-width: 961px)";

function shimState(): ShimState {
  const holder = window as unknown as Record<string, ShimState | undefined>;
  holder[STATE_KEY] ??= { router: null, committed: location.pathname, direction: null, installed: false };
  return holder[STATE_KEY];
}

function navigationApi(): NavigationLike | undefined {
  return (window as Window & { navigation?: NavigationLike }).navigation;
}

/** "navigate" terpicu sebelum "popstate": catat arah (indeks entri tujuan vs entri sekarang). */
function onNavigate(event: Event) {
  const e = event as NavigateEventLike;
  const current = navigationApi()?.currentEntry;
  if (e.navigationType === "traverse" && current) shimState().direction = e.destination.index < current.index ? "back" : "forward";
}

function onPopState(event: PopStateEvent) {
  const state = shimState();
  const dir: Direction = state.direction ?? "back"; // tanpa Navigation API: anggap kembali
  state.direction = null;
  const router = state.router;
  const nextEntry = (event.state as { __NA?: boolean } | null)?.__NA === true;
  if (!router || !nextEntry || event.hasUAVisualTransition || matchMedia(SKIP_MEDIA).matches) return;
  if (!location.pathname.startsWith(HUB_PREFIX) || location.pathname === state.committed) return;
  event.stopImmediatePropagation();
  const href = location.pathname + location.search + location.hash;
  setTimeout(() => router.replace(href, { scroll: false, transitionTypes: [dir === "back" ? "nav-back" : "nav-forward"] }), 0);
}

function install() {
  if (typeof window === "undefined" || !("startViewTransition" in document)) return;
  const state = shimState();
  if (state.installed) return;
  state.installed = true;
  navigationApi()?.addEventListener("navigate", onNavigate);
  window.addEventListener("popstate", onPopState);
}
install();

/** Menghubungkan router & path aktif ke pencegat di atas; dirender sekali di kerangka hub. */
export function TraverseTransitions() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const state = shimState();
    state.router = router;
    return () => { if (state.router === router) state.router = null; };
  }, [router]);
  useEffect(() => { shimState().committed = pathname; }, [pathname]);
  return null;
}
