"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { DashboardSummaryDto } from "@/lib/dashboard/schemas";
import { api } from "@/lib/frontend/api";
import { demoSummary, demoRows } from "@/lib/frontend/demo";
import { number, rupiah } from "@/lib/frontend/format";
import { modulesFor } from "@/lib/frontend/modules";
import type { Row } from "@/lib/frontend/types";
import { useHub } from "./context";
import { Icon } from "./icon";

export function Dashboard() {
  const { me, demo } = useHub();
  const [summary, setSummary] = useState<DashboardSummaryDto | null>(null);
  const [announcements, setAnnouncements] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const isSchool = me.user.role === "SCHOOL_ADMIN";
  useEffect(() => {
    let active = true;
    if (!isSchool) return;
    if (demo) { Promise.resolve().then(() => { if (active) { setSummary(demoSummary as DashboardSummaryDto); setAnnouncements(demoRows("/school/announcements") as Row[]); } }); return () => { active = false; }; }
    api("/school/dashboard/summary").then(r => { if (active) { setSummary(r.data as DashboardSummaryDto); setError(""); } }).catch(e => { if (active) setError(e.message); });
    api("/school/announcements?limit=3").then(r => { if (active) setAnnouncements(r.data as Row[]); }).catch(() => {});
    return () => { active = false; };
  }, [demo, isSchool, retry]);
  const date = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  return <div className="dashboard"><div className="page-heading"><div><h1>Selamat datang, {me.user.name.split(" ")[0]}</h1><p>{date}</p></div>{isSchool && <Link href="/hub/attendance" className="button primary">Pantau kehadiran<Icon name="arrow" size={18} /></Link>}</div>
    {error && <div className="error-message" role="alert">{error}<button className="text-button" onClick={() => setRetry(v => v + 1)}>Coba lagi</button></div>}
    {isSchool ? <><div className="stat-grid"><Stat title="Siswa aktif" value={summary ? number(summary.students.active) : "—"} icon="users" note={summary ? `${number(summary.students.draft)} siswa masih draf` : "Memuat…"} /><Stat title="Kehadiran hari ini" value={summary ? `${summary.attendanceToday.presentPct}%` : "—"} icon="check" note={summary ? `${number(summary.attendanceToday.present + summary.attendanceToday.late)} siswa sudah hadir` : "Memuat…"} /><Stat title="SPP terkumpul" value={summary ? rupiah(summary.billing.period?.collectedAmount ?? 0) : "—"} icon="wallet" note="Periode bulan berjalan" /><Stat title="Rapor diterbitkan" value={summary ? number(summary.reportCards.published) : "—"} icon="report" note={summary?.reportCards.term?.label ?? "Semester aktif"} /></div><div className="dashboard-columns"><AttendancePanel summary={summary} /><AttentionPanel summary={summary} /></div><NewsPanel announcements={announcements} /></> : <RoleOverview />}
  </div>;
}
function Stat({ title, value, icon, note }: { title: string; value: string; icon: string; note: string }) { return <div className="stat-card"><div><span>{title}</span><span className="stat-icon"><Icon name={icon} size={20} /></span></div><strong>{value}</strong><small>{note}</small></div>; }
function NewsPanel({ announcements }: { announcements: Row[] }) {
  return <section className="panel"><div className="panel-heading"><h2>Pengumuman terbaru</h2><Link href="/hub/announcements" className="text-link">Lihat semua <Icon name="arrow" size={15} /></Link></div><ul className="news-list">{announcements.slice(0, 3).map(a => <li key={String(a.id)}><Link href="/hub/announcements"><strong>{String(a.title)}</strong><small>{a.status === "DRAFT" ? "Draf" : "Terbit"}</small></Link></li>)}</ul>{announcements.length === 0 && <p className="empty-line"><Icon name="megaphone" size={22} />Belum ada pengumuman.</p>}</section>;
}
function AttendancePanel({ summary }: { summary: DashboardSummaryDto | null }) {
  const stats = summary?.attendanceToday;
  const segments = [{ label: "Hadir tepat waktu", value: stats?.present ?? 0, color: "#15803d" }, { label: "Terlambat", value: stats?.late ?? 0, color: "#d97706" }, { label: "Izin & sakit", value: (stats?.izin ?? 0) + (stats?.sakit ?? 0), color: "#2563eb" }, { label: "Alpa / belum absen", value: (stats?.alpha ?? 0) + (stats?.notYet ?? 0), color: "#cbd5e1" }];
  let start = 0;
  const gradient = segments.map(s => { const from = start; start += s.value / (stats?.eligible || 1) * 100; return `${s.color} ${from}% ${start}%`; }).join(",");
  return <section className="panel"><div className="panel-heading"><h2>Kehadiran hari ini</h2></div><div className="attendance-visual"><div className="attendance-donut" role="img" aria-label={`Kehadiran ${stats?.presentPct ?? 0} persen`} style={{ background: `conic-gradient(${stats?.eligible ? gradient : "#e2e8f0 0% 100%"})` }}><div><strong>{stats?.presentPct ?? "—"}<small>%</small></strong><span>Tingkat kehadiran</span></div></div><div className="chart-legend">{segments.map(s => <div key={s.label}><span className="legend-dot" style={{ background: s.color }} /><span>{s.label}</span><strong>{number(s.value)}</strong></div>)}<Link className="text-link" href="/hub/attendance">Lihat detail kehadiran <Icon name="arrow" size={14} /></Link></div></div></section>;
}
function AttentionPanel({ summary }: { summary: DashboardSummaryDto | null }) {
  const tasks = [{ title: "Pembayaran menunggu verifikasi", note: "Bukti transfer siap untuk ditinjau", count: summary?.billing.pendingVerification ?? 0, href: "/hub/billing", icon: "wallet" }, { title: "Siswa belum diaktifkan", note: "Lengkapi data dan aktifkan akun", count: summary?.students.draft ?? 0, href: "/hub/students", icon: "users" }, { title: "Rapor belum diterbitkan", note: "Periksa nilai sebelum menerbitkan", count: Math.max(0, (summary?.reportCards.activeStudents ?? 0) - (summary?.reportCards.published ?? 0)), href: "/hub/reports", icon: "report" }];
  return <section className="panel attention-panel"><div className="panel-heading"><h2>Perlu ditindaklanjuti</h2></div><div className="task-list">{tasks.map(t => <Link key={t.title} href={t.href}><span className="stat-icon"><Icon name={t.icon} size={19} /></span><span><strong>{t.title}</strong><small>{t.note}</small></span><b>{number(t.count)}</b><Icon name="chevron" size={14} /></Link>)}</div></section>;
}
function RoleOverview() {
  const { me } = useHub();
  return <nav className="role-card-grid" aria-label="Menu utama">{modulesFor(me.user.role).slice(0, 6).map(m => <Link key={m.key} className="role-card" href={`/hub/${m.key}`}><span className="stat-icon"><Icon name={m.icon} size={22} /></span><h2>{m.title}</h2><p>{m.description}</p></Link>)}</nav>;
}
