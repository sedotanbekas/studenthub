"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/frontend/api";
import { isKnownSection, isRestricted, modulesFor, resolveSection, sectionAllowed, sectionFromPath } from "@/lib/frontend/modules";
import { applyGlassMode, applyTheme, glassModeFor, readGlassPreference } from "@/lib/frontend/theme";
import { resolveTheme } from "@/lib/schools/theme-rules";
import type { Identity } from "@/lib/frontend/types";
import { HubContext } from "./context";
import { DemoBanner, Sidebar, TabBar, Topbar, deviceMemory } from "./frame";
import { Brand } from "./icon";
import { Login } from "./login";
import { cancelPageSlide, playPageSlide } from "./page-slide";
import { useHubSession } from "./use-session";

/**
 * Kerangka hub yang BERTAHAN antarhalaman (dipasang di app/hub/layout.tsx): sesi, tema sekolah,
 * sidebar/topbar/tab bar. Isi halaman (children) berganti per bagian dengan transisi di page.tsx.
 */
interface NavData { readonly userId: string; readonly unread: number; readonly schools: { id: string; name: string }[] }

/** Data navigasi terikat pada user: data milik akun sebelumnya tidak pernah tampil untuk akun berikutnya. */
function useNavigationData(me: Identity | null, demo: boolean): Omit<NavData, "userId"> {
  const [data, setData] = useState<NavData | null>(null);
  useEffect(() => {
    if (!me || demo || isRestricted(me)) return;
    let active = true;
    const userId = me.user.id;
    const merge = (patch: Partial<NavData>) => { if (active) setData(prev => ({ unread: 0, schools: [], ...(prev?.userId === userId ? prev : {}), ...patch, userId })); };
    api("/notifications/unread-count").then(r => merge({ unread: Number((r.data as { total?: number }).total ?? 0) })).catch(() => {});
    if (me.user.role === "SUPER_ADMIN") api("/platform/schools?limit=100").then(r => merge({ schools: r.data as { id: string; name: string }[] })).catch(() => {});
    return () => { active = false; };
  }, [me, demo]);
  return data && me && !demo && data.userId === me.user.id ? data : { unread: 0, schools: [] };
}

/** Tema sekolah milik identitas aktif (keluar/ganti akun -> bawaan) + mode kaca pilihan perangkat, juga di halaman masuk. */
function useAppearance(me: Identity | null) {
  const theme = me?.school?.theme;
  useEffect(() => { applyTheme(theme ? resolveTheme(theme) : null); }, [theme]);
  useEffect(() => { applyGlassMode(glassModeFor(readGlassPreference(localStorage), deviceMemory())); }, []);
}

/** Bagian milik peran lain (mis. lewat tombol kembali setelah ganti akun) -> alihkan ke beranda. */
function useSectionGuard(me: Identity | null, section: string) {
  const router = useRouter();
  const forbidden = Boolean(me && !isRestricted(me) && isKnownSection(section) && !sectionAllowed(me.user.role, section));
  useEffect(() => { if (forbidden) { cancelPageSlide(); router.replace("/hub"); } }, [forbidden, router]);
}

/** Laci navigasi HP: fokus pindah ke laci, Escape menutup, fokus kembali ke tombol pembuka. */
function useDrawer() {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const show = useCallback(() => { opener.current = document.activeElement as HTMLElement | null; setOpen(true); }, []);
  const hide = useCallback((restoreFocus = true) => { setOpen(false); if (restoreFocus) opener.current?.focus(); }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, hide]);
  return { open, show, hide };
}

export function HubShell({ children }: { children: ReactNode }) {
  const session = useHubSession();
  const { me, demo, schoolId, notice } = session;
  const pathname = usePathname();
  const section = sectionFromPath(pathname);
  // Halaman baru sudah di DOM tetapi belum dilukis: jalankan geser dari tangkapan halaman lama.
  useLayoutEffect(() => { playPageSlide(pathname); }, [pathname]);
  const drawer = useDrawer();
  const { schools, unread } = useNavigationData(me, demo);
  useAppearance(me);
  useSectionGuard(me, section);
  const toast = notice ? <div className="toast" role="status">{notice}</div> : null;
  if (!session.ready) return <main className="standalone"><Brand /><div className="loader" /><p>Memuat…</p></main>;
  if (!me) return <><Login onLogin={session.login} onDemo={session.startDemo} />{toast}</>;
  const restricted = isRestricted(me);
  const { home, module: current } = resolveSection(me.user.role, restricted, section);
  const value = { me, demo, schoolId, toast: session.setNotice, reloadMe: session.reloadMe, logout: session.logout, saveDemoTheme: session.saveDemoTheme };
  return <HubContext.Provider value={value}><div className="app-shell">
    {drawer.open && <button className="sidebar-overlay" aria-label="Tutup navigasi" onClick={() => drawer.hide()} />}
    <Sidebar me={me} modules={modulesFor(me.user.role)} current={current} home={home} unread={unread} open={drawer.open} onNavigate={() => drawer.hide(false)} onLogout={session.logout} />
    <div className="main-shell" inert={drawer.open}><Topbar key={me.user.id} title={current?.title ?? "Beranda"} home={home || restricted} unread={unread} me={me} onMenu={drawer.show} />
      <main id="main-content" className="page-content">{demo && <DemoBanner me={me} onPersona={session.switchPersona} onExit={session.logout} />}
        {me.user.role === "SUPER_ADMIN" && current?.paths.some(p => p.startsWith("/school/")) && <label className="scope-select">Sekolah yang dikelola<select value={schoolId} onChange={e => session.setSchoolId(e.target.value)}><option value="">Pilih sekolah terlebih dahulu</option>{schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
        {restricted && <div className="info-message">{me.user.mustChangePassword ? "Sebelum melanjutkan, ganti kata sandi awal untuk mengamankan akunmu." : "Aktifkan autentikasi dua langkah terlebih dahulu untuk mengamankan akun super admin."}</div>}
        {children}
      </main></div>
    <TabBar me={me} section={restricted ? "security" : section} menuOpen={drawer.open} inert={drawer.open} onMenu={drawer.show} />
    {toast}
  </div></HubContext.Provider>;
}
