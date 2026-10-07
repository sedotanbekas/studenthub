"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { AppEnv } from "@/lib/frontend/app-env";
import { DEMO_PERSONAS, demoPersonaForUser } from "@/lib/frontend/demo-personas";
import { initials } from "@/lib/frontend/format";
import { roleLabels, tabItems } from "@/lib/frontend/modules";
import { applyGlassMode, glassModeFor, readGlassPreference, writeGlassPreference, type GlassPreference } from "@/lib/frontend/theme";
import type { Identity, Module } from "@/lib/frontend/types";
import { badgeLabel } from "@/lib/frontend/badge-poll-rules";
import { EnvBadge, EnvSwitch } from "./env-switch";
import { HubLink } from "./hub-link";
import { capturePage, setSlideTabs } from "./page-slide";
import { useBranding } from "./branding";
import { Brand, BrandMark, Icon } from "./icon";

/** Kerangka hub: sidebar (laci di HP), topbar kaca, tab bar HP, banner demo, dan pilihan tampilan. */
interface SidebarProps { me: Identity; env: AppEnv | null; modules: Module[]; current?: Module; home: boolean; unread: number; open: boolean; onNavigate: () => void; onLogout: () => Promise<void> }

export function Sidebar({ me, env, modules, current, home, unread, open, onNavigate, onLogout }: SidebarProps) {
  const groups = Array.from(new Set(modules.map(m => m.group)));
  const aside = useRef<HTMLElement>(null);
  // Akun tanpa sekolah/sponsor (super admin): nama aplikasi dari Pengaturan aplikasi (dulu "studenthub.id").
  const { branding } = useBranding();
  // Laci HP dibuka: fokus ke tautan pertama agar keyboard/pembaca layar langsung berada di dalam laci.
  useEffect(() => { if (open) aside.current?.querySelector<HTMLElement>(".nav-item")?.focus(); }, [open]);
  return <aside ref={aside} className={`sidebar ${open ? "open" : ""}`}><HubLink tab href="/hub" className="brand-link" onClick={onNavigate}><Brand /></HubLink><div className="school-switch"><span className="school-icon"><Icon name="school" size={20} /></span><span><strong>{me.school?.name ?? me.sponsor?.companyName ?? branding.appName}</strong><small>{roleLabels[me.user.role]}</small></span></div>
    <nav aria-label="Navigasi utama"><HubLink tab onClick={onNavigate} className={`nav-item ${home ? "active" : ""}`} href="/hub" aria-current={home ? "page" : undefined}><Icon name="grid" />Beranda</HubLink>{groups.map(group => <div className="nav-group" key={group}><span className="nav-label">{group}</span>{modules.filter(m => m.group === group).map(m => <HubLink tab key={m.key} onClick={onNavigate} className={`nav-item ${current?.key === m.key ? "active" : ""}`} aria-current={current?.key === m.key ? "page" : undefined} href={`/hub/${m.key}`}><Icon name={m.icon} /><span>{m.title}</span>{m.key === "notifications" && unread > 0 && <b className="count-badge">{badgeLabel(unread)}</b>}</HubLink>)}</div>)}</nav>
    <EnvSwitch env={env} role={me.user.role} />
    <GlassToggle />
    <button className="account-button" onClick={() => void onLogout()}><span className="avatar">{initials(me.user.name)}</span><span><strong>{me.user.name}</strong><small>Keluar dari akun</small></span><Icon name="logout" size={18} /></button></aside>;
}

export const deviceMemory = (): number | undefined => (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

/** Sakelar tampilan kontras tinggi (tanpa efek kaca) per perangkat; penerapan awal dilakukan HubShell. */
function GlassToggle() {
  const [preference, setPreference] = useState<GlassPreference>("auto");
  useEffect(() => { const stored = readGlassPreference(localStorage); Promise.resolve().then(() => setPreference(stored)); }, []);
  function toggle(on: boolean) {
    const next: GlassPreference = on ? "off" : "auto";
    writeGlassPreference(localStorage, next); setPreference(next);
    applyGlassMode(glassModeFor(next, deviceMemory()));
  }
  return <label className="glass-toggle"><Icon name="contrast" size={18} /><span>Tampilan kontras tinggi</span><input type="checkbox" role="switch" checked={preference === "off"} onChange={e => toggle(e.target.checked)} /></label>;
}

interface TopbarProps { title: string; home: boolean; unread: number; me: Identity; env: AppEnv | null; onMenu: () => void }

export function Topbar({ title, home, unread, me, env, onMenu }: TopbarProps) {
  const back = useBack();
  return <header className="topbar"><button className="icon-button mobile-menu" aria-label="Buka navigasi" onClick={onMenu}><Icon name="menu" /></button>
    {home ? <span className="topbar-mark"><BrandMark /></span> : <button className="icon-button back-button" aria-label="Kembali" onClick={back}><Icon name="back" size={22} /></button>}
    {/* key: judul baru = elemen baru, sehingga animasi masuknya (transitions.css) selalu berjalan. */}
    <strong key={title} className="topbar-title">{title}</strong>
    <div className="topbar-tools"><EnvBadge env={env} /><HubLink className="icon-button notification-button" href="/hub/notifications" aria-label={unread > 0 ? `Notifikasi, ${badgeLabel(unread)} belum dibaca` : "Notifikasi"}><Icon name="bell" />{unread > 0 && <i />}</HubLink><HubLink className="avatar small" href="/hub/security" aria-label="Keamanan akun">{initials(me.user.name)}</HubLink></div></header>;
}

/** Kembali seperti iOS: ke halaman sebelumnya di dalam hub bila ada (riwayat tab ini), selain itu ke beranda. */
function useBack(): () => void {
  const router = useRouter();
  const pathname = usePathname();
  const visited = useRef<string[]>([]);
  useEffect(() => {
    const stack = visited.current;
    if (stack.at(-2) === pathname) stack.pop();
    else if (stack.at(-1) !== pathname) stack.push(pathname);
  }, [pathname]);
  // router.back() memicu popstate yang ditangkap page-slide; jalur cadangan menangkap sendiri.
  return () => { if (visited.current.length > 1) router.back(); else { capturePage("back"); router.replace("/hub", { scroll: false }); } };
}

export function TabBar({ me, section, menuOpen, inert, onMenu }: { me: Identity; section: string; menuOpen: boolean; inert: boolean; onMenu: () => void }) {
  const role = me.user.role;
  // Tab disaring hak peran akses (RBAC 2026-10-07); kunci string agar efek tidak berulang tiap render.
  const permissionKey = me.permissions.join(",");
  const tabs = tabItems(role, me.permissions);
  // Urutan tab menentukan arah geser antarhalaman utama (page-slide.ts).
  useEffect(() => { setSlideTabs(tabItems(role, permissionKey ? permissionKey.split(",") : []).map(t => t.href)); }, [role, permissionKey]);
  return <nav className="tab-bar" aria-label="Navigasi cepat" inert={inert}>{tabs.map(t => <HubLink tab key={t.key} href={t.href} className={`tab-item ${section === t.key ? "active" : ""}`} aria-current={section === t.key ? "page" : undefined}><Icon name={t.icon} size={22} /><span>{t.label}</span></HubLink>)}
    <button type="button" className="tab-item" aria-label="Menu, buka navigasi" aria-expanded={menuOpen} onClick={onMenu}><Icon name="menu" size={22} /><span>Menu</span></button></nav>;
}

export function DemoBanner({ me, onPersona, onExit }: { me: Identity; onPersona: (key: string) => void; onExit: () => Promise<void> }) {
  return <div className="demo-banner"><span><Icon name="spark" size={16} /> Mode demo · data contoh</span><select aria-label="Peran demo" value={demoPersonaForUser(me.user.id)?.key ?? "SCHOOL_ADMIN"} onChange={e => onPersona(e.target.value)}>{DEMO_PERSONAS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}</select><button className="text-button" onClick={() => void onExit()}>Keluar demo <Icon name="arrow" size={15} /></button></div>;
}
