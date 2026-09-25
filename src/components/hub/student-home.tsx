"use client";
import { HubLink as Link } from "./hub-link";
import { useEffect, useState } from "react";
import type { TodayDto } from "@/lib/attendance/student-schemas";
import { api } from "@/lib/frontend/api";
import { schoolClock, todayHeadline, type Headline } from "@/lib/frontend/attendance";
import { demoRows } from "@/lib/frontend/demo";
import { demoPersonaForUser, demoTodayFor } from "@/lib/frontend/demo-personas";
import { display, initials } from "@/lib/frontend/format";
import type { Row } from "@/lib/frontend/types";
import { useHub } from "./context";
import { Icon } from "./icon";

/**
 * Beranda siswa: kartu identitas (nama, kelas, jam sekolah berjalan, status absen), grid menu besar,
 * dan pengumuman terbaru. Sengaja sedikit elemen agar cepat dipahami di layar HP.
 */
const TILES = [
  { href: "/hub/my-attendance?absen=1", icon: "location", title: "Absen", tone: "blue" },
  { href: "/hub/my-attendance#riwayat", icon: "history", title: "Riwayat", tone: "violet" },
  { href: "/hub/my-leave", icon: "calendar", title: "Izin & sakit", tone: "orange" },
  { href: "/hub/my-reports", icon: "report", title: "Rapor", tone: "green" },
  { href: "/hub/my-billing", icon: "wallet", title: "Tagihan", tone: "teal" },
  { href: "/hub/my-calendar", icon: "book", title: "Kalender", tone: "rose" },
] as const;

function useStudentHome() {
  const { demo, me } = useHub();
  const [className, setClassName] = useState<string | null>(null);
  const [headline, setHeadline] = useState<Headline | null>(null);
  const [news, setNews] = useState<Row[] | null>(null);
  useEffect(() => {
    let active = true;
    if (demo) {
      Promise.resolve().then(() => { if (!active) return; const persona = demoPersonaForUser(me.user.id); setClassName(persona?.className ?? null); setHeadline(todayHeadline(demoTodayFor(persona?.key ?? "STUDENT"))); setNews((demoRows("/notifications") as Row[]).slice(0, 3)); });
      return () => { active = false; };
    }
    api("/student/profile").then(r => { if (active) setClassName((r.data as { className: string | null }).className); }).catch(() => {});
    api("/student/attendance/today").then(r => { if (active) setHeadline(todayHeadline(r.data as TodayDto)); })
      .catch(() => { if (active) setHeadline({ tone: "neutral", title: "Absen lewat HP", note: "Buka Student Hub dari HP untuk absen." }); });
    api("/notifications?limit=3").then(r => { if (active) setNews(r.data as Row[]); }).catch(() => { if (active) setNews([]); });
    return () => { active = false; };
  }, [demo, me.user.id]);
  return { className, headline, news };
}

function Clock({ zone }: { zone: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { const tick = () => setNow(new Date()); tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer); }, []);
  if (!now) return <div className="clock" aria-hidden="true"><strong>--:--</strong></div>;
  const c = schoolClock(now, zone);
  return <div className="clock"><div><strong><time dateTime={`${c.hours}:${c.minutes}`}>{c.hours}:{c.minutes}</time></strong><span className="clock-seconds" aria-hidden="true">:{c.seconds}</span><small>{c.zoneLabel}</small></div><span className="date-chip">{c.date}</span></div>;
}

export function StudentHome() {
  const { me } = useHub();
  const { className, headline, news } = useStudentHome();
  return <div className="student-home">
    <section className="id-card" aria-label="Identitas siswa">
      <div className="id-top"><span className="avatar light">{initials(me.user.name)}</span><div><span className="kicker">SISWA{className ? ` · ${className}` : ""}</span><h1>{me.user.name}</h1><p>{me.school?.name}</p></div></div>
      <Clock zone={me.school?.timezone ?? "WIB"} />
      <p className={`id-status tone-${headline?.tone ?? "neutral"}`} role="status"><Icon name={headline?.tone === "success" || headline?.tone === "warning" ? "check" : "location"} size={18} /><span><strong>{headline?.title ?? "Memuat status absen…"}</strong>{headline && <small>{headline.note}</small>}</span></p>
    </section>
    <nav className="tile-grid" aria-label="Menu siswa">{TILES.map(t => <Link key={t.href} href={t.href} className={`tile tone-${t.tone}`}><span className="tile-icon"><Icon name={t.icon} size={26} /></span><strong>{t.title}</strong></Link>)}</nav>
    <section aria-labelledby="news-title"><div className="section-label"><h2 id="news-title">Pengumuman</h2><Link className="text-link" href="/hub/notifications">Lihat semua</Link></div>
      <div className="panel news-panel">{news === null ? <div className="skeleton" /> : news.length === 0 ? <p className="empty-line"><Icon name="megaphone" size={22} />Tidak ada pengumuman baru.</p>
        : <ul className="news-list">{news.map(n => <li key={String(n.id)}><Link href="/hub/notifications"><strong>{String(n.title ?? "Pengumuman")}</strong><small>{display(n.createdAt)}{n.readAt ? "" : " · Baru"}</small></Link></li>)}</ul>}</div>
    </section>
  </div>;
}
