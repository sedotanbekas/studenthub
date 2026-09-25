"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/frontend/api";
import { modulesFor, roleLabels } from "@/lib/frontend/modules";
import { initials } from "@/lib/frontend/format";
import type { Identity, Module, Role } from "@/lib/frontend/types";
import { HubContext } from "./context";
import { Brand, Icon } from "./icon";
import { Login } from "./login";
import { Dashboard } from "./dashboard";
import { StudentHome } from "./student-home";
import { AttendancePage } from "./attendance/attendance-page";
import { Workspace } from "./workspace";

const demoIdentity: Identity = { user: { id: "demo", name: "Adinda Putri", email: "adinda@sekolah.sch.id", role: "SCHOOL_ADMIN", mustChangePassword: false, totpEnrollmentRequired: false }, school: { id: "demo", name: "SMA Cendekia Nusantara", timezone: "WIB" }, sponsor: null, permissions: [] };
function useNavigationData(me: Identity | null, demo: boolean) {
  const [schools, setSchools] = useState<{ id: string; name: string }[]>([]);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!me || demo || me.user.mustChangePassword || me.user.totpEnrollmentRequired) return;
    let active = true;
    api("/notifications/unread-count").then(r => { if (active) setUnread(Number((r.data as { total?: number }).total ?? 0)); }).catch(() => {});
    if (me.user.role === "SUPER_ADMIN") api("/platform/schools?limit=100").then(r => { if (active) setSchools(r.data as { id: string; name: string }[]); }).catch(() => {});
    return () => { active = false; };
  }, [me, demo]);
  return { schools, unread };
}
export function Hub({ section }: { section: string }) {
  const [me, setMe] = useState<Identity | null>(null);
  const [ready, setReady] = useState(false);
  const [demo, setDemo] = useState(false);
  const [schoolId, setSchoolId] = useState("");
  const [menu, setMenu] = useState(false);
  const [notice, setNotice] = useState("");
  const { schools, unread } = useNavigationData(me, demo);
  async function reloadMe() { const result = await api("/auth/me"); setMe(result.data as Identity); setReady(true); }
  useEffect(() => {
    let active = true;
    const storedRole = sessionStorage.getItem("studenthub_demo_role") as Role | null;
    if (sessionStorage.getItem("studenthub_demo") === "true") { Promise.resolve().then(() => { if (active) { setDemo(true); setMe({ ...demoIdentity, user: { ...demoIdentity.user, role: storedRole && storedRole in roleLabels ? storedRole : "SCHOOL_ADMIN" } }); setReady(true); } }); }
    else api("/auth/me").then(r => { if (active) setMe(r.data as Identity); }).catch(() => {}).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const expired = () => { setMe(null); setNotice("Sesi berakhir. Silakan masuk kembali."); };
    window.addEventListener("studenthub:expired", expired);
    Promise.resolve().then(() => setSchoolId(sessionStorage.getItem("studenthub_school") ?? ""));
    return () => window.removeEventListener("studenthub:expired", expired);
  }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 4500); return () => clearTimeout(timer); }, [notice]);
  function startDemo() { sessionStorage.setItem("studenthub_demo", "true"); setDemo(true); setMe(demoIdentity); }
  async function logout() {
    try { if (!demo) await api("/auth/logout", { method: "POST" }); sessionStorage.removeItem("studenthub_demo"); sessionStorage.removeItem("studenthub_demo_role"); sessionStorage.removeItem("studenthub_school"); setDemo(false); setMe(null); setSchoolId(""); }
    catch (e) { setNotice(e instanceof Error ? e.message : "Gagal keluar."); }
  }
  if (!ready) return <main className="standalone"><Brand /><div className="loader" /><p>Memuat…</p></main>;
  if (!me) return <><Login onLogin={reloadMe} onDemo={startDemo} />{notice && <div className="toast" role="status">{notice}</div>}</>;
  const modules = modulesFor(me.user.role);
  const restricted = me.user.mustChangePassword || me.user.totpEnrollmentRequired;
  const current = modules.find(m => m.key === (restricted ? "security" : section));
  const home = section === "dashboard" && !restricted;
  return <HubContext.Provider value={{ me, demo, schoolId, toast: setNotice, reloadMe, logout }}><div className="app-shell">
    {menu && <button className="sidebar-overlay" aria-label="Tutup navigasi" onClick={() => setMenu(false)} />}
    <Sidebar me={me} modules={modules} current={current} home={home} unread={unread} open={menu} onNavigate={() => setMenu(false)} onLogout={logout} />
    <div className="main-shell"><header className="topbar"><button className="icon-button mobile-menu" aria-label="Buka navigasi" onClick={() => setMenu(true)}><Icon name="menu" /></button><strong className="topbar-title">{current?.title ?? "Beranda"}</strong><div className="topbar-tools"><Link className="icon-button notification-button" href="/hub/notifications" aria-label={unread > 0 ? `Notifikasi, ${unread} belum dibaca` : "Notifikasi"}><Icon name="bell" />{unread > 0 && <i />}</Link><Link className="avatar small" href="/hub/security" aria-label="Keamanan akun">{initials(me.user.name)}</Link></div></header>
      <main id="main-content" className="page-content">{demo && <DemoBanner me={me} onRole={role => { sessionStorage.setItem("studenthub_demo_role", role); setMe({ ...demoIdentity, user: { ...demoIdentity.user, role } }); }} onExit={logout} />}
      {me.user.role === "SUPER_ADMIN" && current?.paths.some(p => p.startsWith("/school/")) && <label className="scope-select">Sekolah yang dikelola<select value={schoolId} onChange={e => { setSchoolId(e.target.value); sessionStorage.setItem("studenthub_school", e.target.value); }}><option value="">Pilih sekolah terlebih dahulu</option>{schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
      {restricted && <div className="info-message">{me.user.mustChangePassword ? "Sebelum melanjutkan, ganti kata sandi awal untuk mengamankan akunmu." : "Aktifkan autentikasi dua langkah terlebih dahulu untuk mengamankan akun super admin."}</div>}
      {current?.key === "my-attendance" ? <AttendancePage /> : current ? <Workspace key={`${current.key}-${schoolId}-${demo}-${me.user.role}`} module={current} /> : home ? me.user.role === "STUDENT" ? <StudentHome /> : <Dashboard /> : <div className="empty-state"><Icon name="search" size={35} /><h2>Halaman tidak ditemukan</h2><Link className="button primary" href="/hub">Kembali ke beranda</Link></div>}
      </main></div>
    {notice && <div className="toast" role="status">{notice}</div>}
  </div></HubContext.Provider>;
}
interface SidebarProps { me: Identity; modules: Module[]; current?: Module; home: boolean; unread: number; open: boolean; onNavigate: () => void; onLogout: () => Promise<void> }
function Sidebar({ me, modules, current, home, unread, open, onNavigate, onLogout }: SidebarProps) {
  const groups = Array.from(new Set(modules.map(m => m.group)));
  return <aside className={`sidebar ${open ? "open" : ""}`}><Link href="/hub" className="brand-link" onClick={onNavigate}><Brand /></Link><div className="school-switch"><span className="school-icon"><Icon name="school" size={20} /></span><span><strong>{me.school?.name ?? me.sponsor?.companyName ?? "Student Hub"}</strong><small>{roleLabels[me.user.role]}</small></span></div>
    <nav aria-label="Navigasi utama"><Link onClick={onNavigate} className={`nav-item ${home ? "active" : ""}`} href="/hub" aria-current={home ? "page" : undefined}><Icon name="grid" />Beranda</Link>{groups.map(group => <div className="nav-group" key={group}><span className="nav-label">{group}</span>{modules.filter(m => m.group === group).map(m => <Link key={m.key} onClick={onNavigate} className={`nav-item ${current?.key === m.key ? "active" : ""}`} aria-current={current?.key === m.key ? "page" : undefined} href={`/hub/${m.key}`}><Icon name={m.icon} /><span>{m.title}</span>{m.key === "notifications" && unread > 0 && <b className="count-badge">{unread}</b>}</Link>)}</div>)}</nav>
    <button className="account-button" onClick={() => void onLogout()}><span className="avatar">{initials(me.user.name)}</span><span><strong>{me.user.name}</strong><small>Keluar dari akun</small></span><Icon name="logout" size={18} /></button></aside>;
}
function DemoBanner({ me, onRole, onExit }: { me: Identity; onRole: (role: Role) => void; onExit: () => Promise<void> }) {
  return <div className="demo-banner"><span><Icon name="spark" size={16} /> Mode demo · data contoh</span><select aria-label="Peran demo" value={me.user.role} onChange={e => onRole(e.target.value as Role)}>{Object.entries(roleLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select><button className="text-button" onClick={() => void onExit()}>Keluar demo <Icon name="arrow" size={15} /></button></div>;
}
