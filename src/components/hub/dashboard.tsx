"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { DashboardSummaryDto } from "@/lib/dashboard/schemas";
import { api } from "@/lib/frontend/api";
import { demoSummary, demoRows } from "@/lib/frontend/demo";
import { number, rupiah } from "@/lib/frontend/format";
import { modulesFor, roleLabels } from "@/lib/frontend/modules";
import type { Row } from "@/lib/frontend/types";
import { useHub } from "./context";
import { Icon } from "./icon";
import { SchoolArt } from "./login";

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
  return <div className="dashboard"><div className="page-heading"><div><span className="eyebrow">HARI BARU, KESEMPATAN BARU</span><h1>Selamat datang, {me.user.name.split(" ")[0]} <span className="greeting-sun"><Icon name="sun" size={28} /></span></h1><p>Mari buat hari ini jadi satu langkah lebih baik.</p></div><span className="date-chip"><Icon name="calendar" size={16} />{date}</span></div>
    <section className="welcome-banner"><div><span className="pill light"><span className="live-dot" /> RUANG {roleLabels[me.user.role].toUpperCase()}</span><h2>Lebih dekat dengan sekolah.<br /><span>Lebih banyak cerita baik.</span></h2><p>Semua yang kamu perlukan, terhubung dalam satu ruang.</p><Link href={`/hub/${isSchool ? "attendance" : modulesFor(me.user.role)[0]!.key}`} className="button dark">{isSchool ? "Pantau kehadiran hari ini" : "Mulai jelajahi workspace"}<Icon name="arrow" size={17} /></Link></div><SchoolArt /></section>
    {error && <div className="error-message" role="alert">{error}<button className="text-button" onClick={() => setRetry(v => v + 1)}>Coba lagi</button></div>}
    {isSchool ? <><div className="section-label"><h2>Sekolah dalam angka</h2><span><span className="live-dot" /> {demo ? "Data contoh" : "Ringkasan terkini"}</span></div><div className="stat-grid"><Stat title="Siswa aktif" value={summary ? number(summary.students.active) : "—"} icon="users" color="sage" note={summary ? `${number(summary.students.draft)} siswa masih dalam draf` : "Memuat data siswa"} /><Stat title="Kehadiran hari ini" value={summary ? `${summary.attendanceToday.presentPct}%` : "—"} icon="check" color="lavender" note={summary ? `${number(summary.attendanceToday.present + summary.attendanceToday.late)} siswa sudah hadir` : "Memuat kehadiran"} /><Stat title="SPP terkumpul" value={summary ? rupiah(summary.billing.period?.collectedAmount ?? 0) : "—"} icon="wallet" color="peach" note="Periode bulan berjalan" /><Stat title="Rapor diterbitkan" value={summary ? number(summary.reportCards.published) : "—"} icon="report" color="blue" note={summary?.reportCards.term?.label ?? "Semester aktif"} /></div><div className="dashboard-columns"><AttendancePanel summary={summary} /><AttentionPanel summary={summary} /></div></> : <RoleOverview />}
    <div className="dashboard-columns bottom-columns"><section className="panel"><div className="panel-heading"><div><h2>Jalan pintas, langkah cepat</h2><p>Mulai dari hal yang ingin kamu selesaikan.</p></div><Icon name="spark" size={20} /></div><div className="quick-grid">{modulesFor(me.user.role).slice(0, 4).map((m, i) => <Link href={`/hub/${m.key}`} key={m.key}><span className={`quick-icon tone-${i}`}><Icon name={m.icon} size={23} /></span><strong>{m.title}</strong><span>Buka halaman <Icon name="arrow" size={13} /></span></Link>)}</div></section><section className="panel"><div className="panel-heading"><div><h2>Kabar sekolah</h2><p>Informasi kecil yang berarti besar.</p></div><Link href={`/hub/${isSchool ? "announcements" : "notifications"}`} className="text-link">Lihat semua <Icon name="arrow" size={14} /></Link></div><div className="announcement-list">{announcements.slice(0, 3).map((a, i) => <Link href="/hub/announcements" key={String(a.id)}><span className={`announcement-icon tone-${i}`}><Icon name={i === 1 ? "leaf" : "megaphone"} size={18} /></span><span><strong>{String(a.title)}</strong><small>{a.status === "DRAFT" ? "Draf pengumuman" : "Informasi sekolah"}</small></span><Icon name="chevron" size={15} /></Link>)}{announcements.length === 0 && <div className="compact-empty"><Icon name="megaphone" size={25} /><p>Kabar terbaru akan hadir di sini.</p><Link className="text-link" href="/hub/notifications">Buka notifikasi <Icon name="arrow" size={14} /></Link></div>}</div></section></div><div className="kind-note"><Icon name="heart" size={16} /><span>Di balik setiap data, ada cerita dan masa depan yang sedang tumbuh.</span></div></div>;
}
function Stat({ title, value, icon, color, note }: { title: string; value: string; icon: string; color: string; note: string }) { return <div className="stat-card"><div><span>{title}</span><span className={`stat-icon ${color}`}><Icon name={icon} size={19} /></span></div><strong>{value}</strong><small>{note}</small></div>; }
function AttendancePanel({ summary }: { summary: DashboardSummaryDto | null }) {
  const stats = summary?.attendanceToday;
  const segments = [{ label: "Hadir tepat waktu", value: stats?.present ?? 0, color: "#527c60" }, { label: "Terlambat", value: stats?.late ?? 0, color: "#b4c79e" }, { label: "Izin & sakit", value: (stats?.izin ?? 0) + (stats?.sakit ?? 0), color: "#ebc992" }, { label: "Alpa / belum absen", value: (stats?.alpha ?? 0) + (stats?.notYet ?? 0), color: "#e8e8df" }];
  let start = 0;
  const gradient = segments.map(s => { const from = start; start += s.value / (stats?.eligible || 1) * 100; return `${s.color} ${from}% ${start}%`; }).join(",");
  return <section className="panel"><div className="panel-heading"><div><h2>Setiap kehadiran berarti</h2><p>Gambaran kehadiran siswa hari ini.</p></div><Link className="icon-button" aria-label="Lihat kehadiran" href="/hub/attendance"><Icon name="arrow" size={18} /></Link></div><div className="attendance-visual"><div className="attendance-donut" role="img" aria-label={`Kehadiran ${stats?.presentPct ?? 0} persen`} style={{ background: `conic-gradient(${stats?.eligible ? gradient : "#e8e8df 0% 100%"})` }}><div><strong>{stats?.presentPct ?? "—"}<small>%</small></strong><span>Tingkat kehadiran</span></div></div><div className="chart-legend">{segments.map(s => <div key={s.label}><span className="legend-dot" style={{ background: s.color }} /><span>{s.label}</span><strong>{number(s.value)}</strong></div>)}<Link className="text-link" href="/hub/attendance">Lihat detail kehadiran <Icon name="arrow" size={14} /></Link></div></div></section>;
}
function AttentionPanel({ summary }: { summary: DashboardSummaryDto | null }) {
  const tasks = [{ title: "Pembayaran menunggu verifikasi", note: "Bukti transfer siap untuk ditinjau", count: summary?.billing.pendingVerification ?? 0, href: "/hub/billing", icon: "wallet", tone: "peach" }, { title: "Siswa belum diaktifkan", note: "Lengkapi data dan aktifkan akun", count: summary?.students.draft ?? 0, href: "/hub/students", icon: "users", tone: "lavender" }, { title: "Rapor belum diterbitkan", note: "Periksa nilai sebelum menerbitkan", count: Math.max(0, (summary?.reportCards.activeStudents ?? 0) - (summary?.reportCards.published ?? 0)), href: "/hub/reports", icon: "report", tone: "sage" }];
  return <section className="panel attention-panel"><div className="panel-heading"><div><h2>Butuh sentuhanmu <span className="small-dot" /></h2><p>Selesaikan satu per satu. Kamu bisa.</p></div></div><div className="task-list">{tasks.map(t => <Link key={t.title} href={t.href}><span className={`stat-icon ${t.tone}`}><Icon name={t.icon} size={18} /></span><span><strong>{t.title}</strong><small>{t.note}</small></span><b>{number(t.count)}</b><Icon name="chevron" size={14} /></Link>)}</div></section>;
}
function RoleOverview() {
  const { me } = useHub();
  return <section><div className="section-label"><h2>Ruang untuk setiap kebutuhan</h2><span>Terhubung dalam satu tempat</span></div><div className="role-card-grid">{modulesFor(me.user.role).slice(0, 3).map((m, i) => <Link key={m.key} className="role-card" href={`/hub/${m.key}`}><span className={`quick-icon tone-${i}`}><Icon name={m.icon} size={25} /></span><h2>{m.title}</h2><p>{m.description}</p><span className="text-link">Mulai di sini <Icon name="arrow" size={16} /></span></Link>)}</div></section>;
}
