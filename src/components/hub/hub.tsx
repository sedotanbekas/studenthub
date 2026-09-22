"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/frontend/api";
import { modulesFor, roleLabels } from "@/lib/frontend/modules";
import { initials } from "@/lib/frontend/format";
import type { Identity, Role } from "@/lib/frontend/types";
import { HubContext } from "./context";
import { Brand, Icon } from "./icon";
import { Login } from "./login";
import { Dashboard } from "./dashboard";
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
  const [search, setSearch] = useState("");
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
  if (!ready) return <main className="standalone"><Brand /><div className="loader" /><p>Menyiapkan ruangmu…</p></main>;
  if (!me) return <Login onLogin={reloadMe} onDemo={startDemo} />;
  const modules = modulesFor(me.user.role);
  const restricted = me.user.mustChangePassword || me.user.totpEnrollmentRequired;
  const current = modules.find(m => m.key === (restricted ? "security" : section));
  const groups = Array.from(new Set(modules.map(m => m.group)));
  return <HubContext.Provider value={{ me, demo, schoolId, toast: setNotice, reloadMe }}><div className="app-shell">
    {menu && <button className="sidebar-overlay" aria-label="Tutup navigasi" onClick={() => setMenu(false)} />}
    <aside className={`sidebar ${menu ? "open" : ""}`}><Link href="/hub" className="brand-link"><Brand /></Link><div className="workspace-label">WORKSPACE</div><div className="school-switch"><span className="school-icon"><Icon name="school" size={19} /></span><span><strong>{me.school?.name ?? me.sponsor?.companyName ?? "Student Hub"}</strong><small>{roleLabels[me.user.role]}</small></span><Icon name="down" size={14} /></div>
      <nav aria-label="Navigasi utama"><Link onClick={() => setMenu(false)} className={`nav-item ${section === "dashboard" && !restricted ? "active" : ""}`} href="/hub"><Icon name="grid" />Beranda<span className="nav-active-dot" /></Link>{groups.map(group => <div className="nav-group" key={group}><span className="nav-label">{group}</span>{modules.filter(m => m.group === group).map(m => <Link key={m.key} onClick={() => setMenu(false)} className={`nav-item ${current?.key === m.key ? "active" : ""}`} href={`/hub/${m.key}`}><Icon name={m.icon} /><span>{m.title}</span>{m.key === "notifications" && unread > 0 && <b className="count-badge">{unread}</b>}</Link>)}</div>)}</nav>
      <div className="sidebar-bottom"><div className="little-note"><Icon name="leaf" size={21} /><strong>Sedikit lebih mudah,<br />setiap harinya.</strong><span>Lebih banyak waktu untuk<br />hal yang berarti.</span></div><button className="account-button" onClick={logout}><span className="avatar">{initials(me.user.name)}</span><span><strong>{me.user.name}</strong><small>Keluar dari akun</small></span><Icon name="logout" size={17} /></button></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Buka navigasi" onClick={() => setMenu(true)}><Icon name="menu" /></button><span>Workspace</span><Icon name="chevron" size={13} /><strong>{current?.title ?? "Beranda"}</strong></div><div className="topbar-tools"><div className="global-search"><Icon name="search" size={17} /><input aria-label="Cari menu" placeholder="Cari sesuatu…" value={search} onChange={e => setSearch(e.target.value)} /><kbd>⌕</kbd>{search && <div className="search-results">{modules.filter(m => m.title.toLowerCase().includes(search.toLowerCase())).map(m => <Link key={m.key} href={`/hub/${m.key}`} onClick={() => setSearch("")}><Icon name={m.icon} />{m.title}</Link>)}{!modules.some(m => m.title.toLowerCase().includes(search.toLowerCase())) && <p>Menu tidak ditemukan.</p>}</div>}</div><Link className="icon-button notification-button" href="/hub/notifications" aria-label="Notifikasi"><Icon name="bell" />{unread > 0 && <i />}</Link><span className="topbar-divider" /><Link className="avatar small" href="/hub/security" aria-label="Keamanan akun">{initials(me.user.name)}</Link></div></header>
      <main id="main-content" className="page-content">{demo && <div className="demo-banner"><span><Icon name="spark" size={15} /> Mode demo · Data contoh untuk menjelajahi tampilan</span><select aria-label="Peran demo" value={me.user.role} onChange={e => { sessionStorage.setItem("studenthub_demo_role", e.target.value); setMe({ ...demoIdentity, user: { ...demoIdentity.user, role: e.target.value as Role } }); }}>{Object.entries(roleLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select><button onClick={logout}>Keluar demo <Icon name="arrow" size={14} /></button></div>}
      {me.user.role === "SUPER_ADMIN" && current?.paths.some(p => p.startsWith("/school/")) && <label className="scope-select">Sekolah yang dikelola<select value={schoolId} onChange={e => { setSchoolId(e.target.value); sessionStorage.setItem("studenthub_school", e.target.value); }}><option value="">Pilih sekolah terlebih dahulu</option>{schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
      {restricted && <div className="info-message">{me.user.mustChangePassword ? "Sebelum melanjutkan, ganti kata sandi awal untuk mengamankan akunmu." : "Aktifkan autentikasi dua langkah terlebih dahulu untuk mengamankan akun super admin."}</div>}
      {current ? <Workspace key={`${current.key}-${schoolId}-${demo}-${me.user.role}`} module={current} /> : section === "dashboard" ? <Dashboard /> : <div className="empty-state"><Icon name="search" size={35} /><h2>Halaman tidak ditemukan</h2><Link className="button primary" href="/hub">Kembali ke beranda</Link></div>}
      <footer className="page-footer"><span>© {new Date().getFullYear()} Student Hub</span><span>Dibuat untuk langkah yang lebih baik <Icon name="leaf" size={13} /></span></footer></main></div>
    {notice && <div className="toast" role="status"><Icon name="check" size={19} />{notice}<button aria-label="Tutup pemberitahuan" onClick={() => setNotice("")}><Icon name="close" size={16} /></button></div>}
  </div></HubContext.Provider>;
}
