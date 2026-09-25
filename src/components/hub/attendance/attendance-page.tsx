"use client";
import { useCallback, useEffect, useState } from "react";
import type { HistoryDto, TodayDto } from "@/lib/attendance/student-schemas";
import { isMobileBrowserAgent } from "@/lib/auth/device";
import { api, ApiError } from "@/lib/frontend/api";
import { todayHeadline } from "@/lib/frontend/attendance";
import { demoHistory } from "@/lib/frontend/demo";
import { demoPersonaForUser, demoTodayFor } from "@/lib/frontend/demo-personas";
import { display, label } from "@/lib/frontend/format";
import { useHub } from "../context";
import { Status } from "../data-view";
import { Icon } from "../icon";
import { CheckInFlow } from "./check-in-flow";

/** Halaman "Absensi" siswa: status hari ini + tombol absen (alur layar penuh) + riwayat bulanan. */
type TodayState = { kind: "loading" } | { kind: "ready"; today: TodayDto } | { kind: "error"; code: string; message: string };

function useToday(version: number): TodayState {
  const { demo, me } = useHub();
  const [state, setState] = useState<TodayState>({ kind: "loading" });
  useEffect(() => {
    let active = true;
    const load = demo ? Promise.resolve(demoTodayFor(demoPersonaForUser(me.user.id)?.key ?? "STUDENT")) : api("/student/attendance/today").then(r => r.data as TodayDto);
    load.then(today => { if (active) setState({ kind: "ready", today }); })
      .catch(e => { if (active) setState({ kind: "error", code: e instanceof ApiError ? e.code : "", message: e instanceof Error ? e.message : "Status absensi belum dapat dimuat." }); });
    return () => { active = false; };
  }, [demo, me.user.id, version]);
  return state;
}

export function AttendancePage() {
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState(false);
  const state = useToday(version);
  const canCheckIn = state.kind === "ready" && state.today.canCheckIn;
  useEffect(() => {
    if (!canCheckIn || new URLSearchParams(window.location.search).get("absen") !== "1") return;
    window.history.replaceState(null, "", window.location.pathname);
    Promise.resolve().then(() => setOpen(true));
  }, [canCheckIn]);
  return <div className="workspace-page attendance-page">
    <div className="page-heading"><div><h1>Absensi</h1><p>Absen masuk dengan lokasi dan foto wajah dari HP.</p></div></div>
    {state.kind === "loading" ? <div className="panel"><div className="skeleton" /><div className="skeleton" /></div>
      : state.kind === "error" ? state.code === "CHECKIN_MOBILE_ONLY" ? <MobileOnly /> : <div className="error-message" role="alert">{state.message}<button className="text-button" onClick={() => setVersion(v => v + 1)}>Coba lagi</button></div>
      : <TodayCard today={state.today} onStart={() => setOpen(true)} />}
    <HistoryPanel version={version} />
    {open && state.kind === "ready" && <CheckInFlow today={state.today} onClose={() => setOpen(false)} onDone={() => setVersion(v => v + 1)} />}
  </div>;
}

function TodayCard({ today, onStart }: { today: TodayDto; onStart: () => void }) {
  const headline = todayHeadline(today);
  return <section className={`today-card tone-${headline.tone}`} aria-labelledby="today-title">
    <div><span className="kicker">Hari ini</span><h2 id="today-title">{headline.title}</h2><p>{headline.note}</p>
      {today.pendingLeave && <p className="today-leave">Pengajuan {label(today.pendingLeave.type).toLowerCase()} kamu masih menunggu persetujuan. Absen masuk akan menggantikannya.</p>}</div>
    {today.canCheckIn && <button className="button primary large" onClick={onStart}><Icon name="location" size={20} />Absen sekarang</button>}
  </section>;
}

function MobileOnly() {
  const { logout } = useHub();
  const phone = typeof navigator !== "undefined" && isMobileBrowserAgent(navigator.userAgent);
  return <section className="today-card tone-neutral"><div><span className="kicker">Absensi dari HP</span><h2>{phone ? "Masuk ulang untuk mengaktifkan absensi" : "Buka Student Hub dari HP kamu"}</h2>
    <p>{phone ? "Sesi ini dibuat sebelum absensi web aktif. Keluar lalu masuk kembali dengan NISN dari HP ini agar HP terdaftar sebagai perangkat absen." : "Absensi memakai GPS dan kamera depan, jadi hanya bisa dilakukan dari HP (browser HP atau aplikasi Student Hub)."}</p></div>
    {phone && <button className="button primary large" onClick={() => void logout()}><Icon name="logout" size={19} />Keluar & masuk ulang</button>}
  </section>;
}

function monthOf(offset: number): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function HistoryPanel({ version }: { version: number }) {
  const { demo } = useHub();
  const [month, setMonth] = useState(() => monthOf(0));
  const [history, setHistory] = useState<{ data: HistoryDto; prev: string | null; next: string | null } | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => demo ? Promise.resolve({ data: demoHistory as unknown as HistoryDto, prev: null, next: null })
    : api(`/student/attendance?month=${month}`).then(r => ({ data: r.data as HistoryDto, prev: (r.meta as { prevMonth?: string | null } | undefined)?.prevMonth ?? null, next: (r.meta as { nextMonth?: string | null } | undefined)?.nextMonth ?? null })), [demo, month]);
  useEffect(() => {
    let active = true;
    load().then(h => { if (active) { setHistory(h); setError(""); } }).catch(e => { if (active) setError(e instanceof Error ? e.message : "Riwayat belum dapat dimuat."); });
    return () => { active = false; };
  }, [load, version]);
  const title = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(new Date(`${month}-01T00:00:00`));
  const s = history?.data.summary;
  return <section className="panel" id="riwayat" aria-labelledby="history-title">
    <div className="panel-heading"><h2 id="history-title">Riwayat {title}</h2><div className="month-nav"><button className="icon-button" aria-label="Bulan sebelumnya" disabled={!history?.prev} onClick={() => history?.prev && setMonth(history.prev)}><Icon name="chevron" size={18} style={{ transform: "rotate(180deg)" }} /></button><button className="icon-button" aria-label="Bulan berikutnya" disabled={!history?.next} onClick={() => history?.next && setMonth(history.next)}><Icon name="chevron" size={18} /></button></div></div>
    {error && <p className="error-message" role="alert">{error}</p>}
    {s && <dl className="summary-strip"><div><dt>Hadir</dt><dd>{s.present}</dd></div><div><dt>Terlambat</dt><dd>{s.late}</dd></div><div><dt>Izin/Sakit</dt><dd>{s.izin + s.sakit}</dd></div><div><dt>Alpa</dt><dd>{s.alpha}</dd></div></dl>}
    {history && (history.data.days.length ? <ul className="history-list">{[...history.data.days].reverse().map(day => <li key={day.date}><span><strong>{display(day.date)}</strong><small>{day.checkInTimeLocal ? `Masuk ${day.checkInTimeLocal}${day.lateMinutes ? ` · terlambat ${day.lateMinutes} menit` : ""}` : label(day.source)}</small></span><Status value={day.status} /></li>)}</ul> : <p className="muted">Belum ada catatan kehadiran di bulan ini.</p>)}
  </section>;
}
