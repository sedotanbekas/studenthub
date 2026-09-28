"use client";
import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { isKnownSection, isRestricted, sectionAllowed, sectionFromPath } from "@/lib/frontend/modules";
import { scrollKey } from "@/lib/frontend/scroll-memory-rules";
import { resumePlan } from "@/lib/frontend/splash-rules";
import type { Identity } from "@/lib/frontend/types";
import { cancelPageSlide } from "./page-slide";
import { restoreScroll, seedScrollPosition } from "./scroll-memory";
import { awaitResume, readResume, rememberCurrentPage, resumePending, setSplashView, subscribeResume, trackIdentity, type SplashView } from "./splash";

/**
 * Splash & sesi kerja di kerangka hub. Saat identitas akun diketahui (situs dibuka lagi / login ulang),
 * halaman terakhir yang dilihat akun itu beserta posisi gulirnya dilanjutkan — halaman inilah yang
 * disingkap masker splash. Dipanggil HubShell SETELAH layout effect forgetScrollPositions (urutan
 * efek = urutan pemanggilan hook), agar posisi yang dipulihkan tidak ikut terhapus. Mengembalikan true
 * selama halaman terakhir masih dimuat (kerangka menahan beranda agar tidak sempat berkedip).
 */
export function useSplash(me: Identity | null, demo: boolean, ready: boolean, pathname: string): boolean {
  const router = useRouter();
  // Akun sungguhan yang boleh memakai semua bagiannya (bukan demo, bukan akun wajib ganti sandi/TOTP).
  const resumable = me && !demo && !isRestricted(me) ? me.user : null;
  const userId = resumable?.id ?? null;
  const role = resumable?.role ?? null;
  const signedIn = Boolean(me);
  const view: SplashView = !ready ? "loading" : me ? "app" : "login";

  useLayoutEffect(() => {
    if (userId && role) {
      const allowed = (path: string) => { const section = sectionFromPath(path); return isKnownSection(section) && sectionAllowed(role, section); };
      const plan = resumePlan(readResume(), { userId, pathname: location.pathname, now: Date.now(), allowed });
      if (plan) {
        seedScrollPosition(plan.path, plan.y);
        if (scrollKey(plan.path) === scrollKey(location.pathname)) restoreScroll(location.pathname);
        else { awaitResume(plan.path); cancelPageSlide(); router.replace(plan.path, { scroll: false }); }
      }
    }
    trackIdentity(signedIn, userId);
  }, [signedIn, userId, role, router]);

  useLayoutEffect(() => { setSplashView(view, pathname); }, [view, pathname]);
  useEffect(() => { rememberCurrentPage(); }, [pathname, userId]);
  return useSyncExternalStore(subscribeResume, resumePending, () => false);
}
