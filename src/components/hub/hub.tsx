"use client";
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/frontend/api";
import { isKnownSection, isRestricted, modulesFor, resolveSection, sectionAllowed, sectionFromPath } from "@/lib/frontend/modules";
import { applyGlassMode, applyTheme, glassModeFor, readGlassPreference } from "@/lib/frontend/theme";
import { resolveTheme } from "@/lib/schools/theme-rules";
import { demoAllowed, type AppEnv } from "@/lib/frontend/app-env";
import { demoUnreadCount } from "@/lib/frontend/demo";
import { demoPersonaForUser } from "@/lib/frontend/demo-personas";
import type { SessionHint } from "@/lib/frontend/session-hint";
import type { Identity } from "@/lib/frontend/types";
import { unreadBadge } from "@/lib/frontend/unread-badge";
import { HubContext } from "./context";
import { DemoBanner, Sidebar, TabBar, Topbar, deviceMemory } from "./frame";
import { Brand } from "./icon";
import { Login } from "./login";
import { cancelPageSlide, playPageSlide } from "./page-slide";
import { forgetScrollPositions, restoreScroll } from "./scroll-memory";
import { loadSections, useSections } from "./sections";
import { useHubSession } from "./use-session";
import { WebPushBridge, WebPushPrompt } from "./web-push";
import { useSplash } from "./use-splash";

/**
 * Kerangka hub yang BERTAHAN antarhalaman (dipasang di app/hub/layout.tsx): sesi, tema sekolah,
 * sidebar/topbar/tab bar. Isi halaman (children) berganti per bagian dengan transisi di page.tsx.
 */
interface NavData { readonly userId: string; readonly schools: { id: string; name: string }[] }

/** Data navigasi terikat pada user: data milik akun sebelumnya tidak pernah tampil untuk akun berikutnya. */
function useNavigationData(me: Identity | null, demo: boolean): Omit<NavData, "userId"> {
  const [data, setData] = useState<NavData | null>(null);
  useEffect(() => {
    if (!me || demo || isRestricted(me) || me.user.role !== "SUPER_ADMIN") return;
    let active = true;
    const userId = me.user.id;
    api("/platform/schools?limit=100").then(r => { if (active) setData({ userId, schools: r.data as { id: string; name: string }[] }); }).catch(() => {});
    return () => { active = false; };
  }, [me, demo]);
  return data && me && !demo && data.userId === me.user.id ? data : { schools: [] };
}

/** Badge notifikasi: satu poller bersama (unread-badge.ts, N1); demo = angka data contoh, tanpa jaringan. */
function useUnreadBadge(me: Identity | null, demo: boolean): number {
  const live = useSyncExternalStore(unreadBadge.subscribe, unreadBadge.getSnapshot, () => 0);
  const userId = me?.user.id;
  const role = me?.user.role;
  const restricted = me ? isRestricted(me) : true;
  useEffect(() => {
    if (!userId || !role || demo || restricted) { unreadBadge.stop(); return; }
    unreadBadge.start({ userId, role });
    return () => unreadBadge.stop();
  }, [userId, role, demo, restricted]);
  return demo ? demoUnreadCount(userId ? demoPersonaForUser(userId) : undefined) : live;
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
  useEffect(() => { if (forbidden) { cancelPageSlide(); router.replace("/hub", { scroll: false }); } }, [forbidden, router]);
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

/** Modul isi bagian (sections.ts) dimuat begitu ada identitas; halaman aplikasi menunggu modul itu. */
function useSectionsFor(me: Identity | null) {
  const state = useSections();
  const signedIn = Boolean(me);
  useEffect(() => { if (signedIn) void loadSections(); }, [signedIn]);
  return { ready: !me || state.sections !== null, failed: Boolean(me) && state.failed };
}

export function HubShell({ hint, env, children }: { hint: SessionHint; env: AppEnv | null; children: ReactNode }) {
  const session = useHubSession(hint, demoAllowed(env));
  const { me, demo, schoolId, notice } = session;
  const sections = useSectionsFor(me);
  const pathname = usePathname();
  const section = sectionFromPath(pathname);
  // Akun/peran berganti: lupakan posisi gulir akun sebelumnya (sebelum halaman berikutnya dipulihkan).
  const userId = me?.user.id;
  useLayoutEffect(() => { forgetScrollPositions(); }, [userId]);
  // Halaman baru sudah di DOM tetapi belum dilukis: pulihkan posisi gulir terakhirnya, lalu jalankan
  // geser dari tangkapan halaman lama (potongan hantu dihitung dari posisi yang sudah dipulihkan).
  useLayoutEffect(() => { restoreScroll(pathname); playPageSlide(pathname); }, [pathname]);
  // Splash + halaman terakhir yang dilanjutkan (setelah forgetScrollPositions di atas).
  const resuming = useSplash(me, demo, session.ready && sections.ready, pathname);
  const drawer = useDrawer();
  const { schools } = useNavigationData(me, demo);
  const unread = useUnreadBadge(me, demo);
  useAppearance(me);
  useSectionGuard(me, section);
  const toast = notice ? <div className="toast" role="status">{notice}</div> : null;
  if (sections.failed) return <main className="standalone"><Brand /><p>Halaman gagal dimuat. Periksa koneksi internet lalu coba lagi.</p><button type="button" className="button primary" onClick={() => void loadSections()}>Coba lagi</button></main>;
  if (!session.ready || resuming || !sections.ready) return <main className="standalone"><Brand /><div className="loader" /><p>Memuat…</p></main>;
  // Suspense: halaman masuk (HTML server) dihidrasi bertahap setelah kerangka, bukan dalam satu long task (TBT).
  if (!me) return <><Suspense fallback={null}><Login env={env} notice={session.loginNotice} onLogin={session.login} onDemo={session.startDemo} /></Suspense>{toast}</>;
  const restricted = isRestricted(me);
  const { home, module: current } = resolveSection(me.user.role, restricted, section);
  const value = { me, demo, schoolId, toast: session.setNotice, reloadMe: session.reloadMe, logout: session.logout, saveDemoTheme: session.saveDemoTheme };
  return <HubContext.Provider value={value}><div className="app-shell">
    {drawer.open && <button className="sidebar-overlay" aria-label="Tutup navigasi" onClick={() => drawer.hide()} />}
    <Sidebar me={me} env={env} modules={modulesFor(me.user.role)} current={current} home={home} unread={unread} open={drawer.open} onNavigate={() => drawer.hide(false)} onLogout={session.logout} />
    <div className="main-shell" inert={drawer.open}><Topbar key={me.user.id} title={current?.title ?? "Beranda"} home={home || restricted} unread={unread} me={me} env={env} onMenu={drawer.show} />
      {/* .hub-view = seluruh isi yang ikut tergulir, digeser utuh saat pindah halaman (page-slide.ts). */}
      <main id="main-content" className="page-content"><div className="hub-view">{demo && <DemoBanner me={me} onPersona={session.switchPersona} onExit={session.logout} />}
        {me.user.role === "SUPER_ADMIN" && current?.paths.some(p => p.startsWith("/school/")) && <label className="scope-select">Sekolah yang dikelola<select value={schoolId} onChange={e => session.setSchoolId(e.target.value)}><option value="">Pilih sekolah terlebih dahulu</option>{schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
        {/* Akun terbatas: pesan + formulir/tombolnya tampil bersama di kartu tugas halaman Keamanan akun (security-panel.tsx). */}
        {children}
      </div></main></div>
    <TabBar me={me} section={restricted ? "security" : section} menuOpen={drawer.open} inert={drawer.open} onMenu={drawer.show} />
    <WebPushBridge key={me.user.id} me={me} demo={demo} />
    <WebPushPrompt key={`push-${me.user.id}`} me={me} demo={demo} home={home && !drawer.open} toast={session.setNotice} />
    {toast}
  </div></HubContext.Provider>;
}
