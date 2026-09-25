import { ViewTransition, type ReactNode, type ViewTransitionClassPerType } from "react";

/**
 * Transisi antarhalaman hub (React <ViewTransition> + View Transitions API). Dipasang di page.tsx —
 * bukan layout — karena layout tidak dipasang ulang saat pindah halaman. Kelas per tipe navigasi
 * dianimasikan di src/styles/transitions.css (HP: geser ala iOS; desktop: pudar halus). Navigasi
 * tanpa tipe (muat ulang data, refresh) tidak beranimasi. Browser tanpa dukungan: tanpa animasi.
 */
const ENTER: ViewTransitionClassPerType = { "nav-forward": "hub-push-in", "nav-back": "hub-pop-in", default: "none" };
const EXIT: ViewTransitionClassPerType = { "nav-forward": "hub-push-out", "nav-back": "hub-pop-out", default: "none" };

export function PageTransition({ children }: { children: ReactNode }) {
  return <ViewTransition enter={ENTER} exit={EXIT} default="none"><div className="hub-page">{children}</div></ViewTransition>;
}
