"use client";
import { useState } from "react";
import { api, scoped } from "@/lib/frontend/api";
import { display, label } from "@/lib/frontend/format";
import type { Row } from "@/lib/frontend/types";
import type { SheetDto } from "@/lib/report-cards/schemas";
import { useHub } from "./context";
import { Icon } from "./icon";
import { Status } from "./data-view";

export function FeedView({ rows, onSelect }: { rows: Row[]; onSelect: (row: Row) => void }) {
  return <div className="feed-grid">{rows.map((row, index) => <button key={String(row.id ?? index)} className="feed-card" onClick={() => onSelect(row)}><span className="feed-top"><span className={`quick-icon tone-${index % 4}`}><Icon name="megaphone" size={22} /></span>{row.status ? <Status value={row.status} /> : <span className="pill">{row.readAt ? "Sudah dibaca" : "Belum dibaca"}</span>}</span><h3>{String(row.title ?? "Informasi sekolah")}</h3><p>{String(row.body ?? row.content ?? "Buka informasi untuk melihat selengkapnya.")}</p><span className="feed-bottom"><small>{display(row.createdAt)}</small><span>Baca selengkapnya <Icon name="arrow" size={15} /></span></span></button>)}</div>;
}
export function CalendarView({ data, onSelect, monthHint }: { data: unknown; onSelect: (row: Row) => void; monthHint?: string }) {
  const calendar = !Array.isArray(data) && data && typeof data === "object" ? data as Row : {};
  const [month, setMonth] = useState(() => String(calendar.month ?? monthHint ?? new Date().toLocaleDateString("sv-SE").slice(0, 7)));
  const holidays = Array.isArray(data) ? data as Row[] : [];
  const days = (calendar.days ?? []) as Row[];
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const count = new Date(year, monthNumber, 0).getDate();
  const offset = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7;
  const title = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(new Date(year, monthNumber - 1, 1));
  function move(delta: number) { const date = new Date(year, monthNumber - 1 + delta, 1); setMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`); }
  return <div className="calendar-view"><div className="calendar-heading"><h2>{title}</h2>{!calendar.month && <div><button className="icon-button" aria-label="Bulan sebelumnya" onClick={() => move(-1)}><Icon name="chevron" style={{ transform: "rotate(180deg)" }} size={17} /></button><button className="icon-button" aria-label="Bulan berikutnya" onClick={() => move(1)}><Icon name="chevron" size={17} /></button></div>}</div><div className="calendar-grid">{["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"].map(day => <div className="calendar-weekday" key={day}>{day}</div>)}{Array.from({ length: offset }, (_, i) => <div className="calendar-cell blank" key={`blank-${i}`} />)}{Array.from({ length: count }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, "0")}`;
    const day = days.find(d => d.date === date);
    const events = holidays.filter(h => String(h.startDate).slice(0, 10) <= date && String(h.endDate).slice(0, 10) >= date);
    const today = date === new Date().toLocaleDateString("sv-SE");
    return <div key={date} className={`calendar-cell ${day?.isSchoolDay === false || events.length ? "holiday" : ""} ${today ? "today" : ""}`}><strong>{i + 1}</strong>{events.map(event => <button key={String(event.id)} onClick={() => onSelect(event)}>{String(event.name)}</button>)}{day?.holidayName ? <small>{String(day.holidayName)}</small> : day?.isSchoolDay === false ? <small>{label(String(day.reason))}</small> : null}</div>;
  })}</div><p className="calendar-note"><span className="legend-dot" style={{ background: "#e8cfaa" }} /> Hari libur mengikuti kalender sekolah. Pilih tanggal libur untuk melihat detail.</p></div>;
}
export function GradeSheet({ sheet, onDone }: { sheet: SheetDto; onDone: () => void }) {
  const { schoolId, demo, toast, me } = useHub();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    if (demo) { setError("Masuk dengan akun untuk menyimpan nilai."); return; }
    setBusy(true); setError("");
    try {
      await api(scoped("/school/report-cards/grades", schoolId), { method: "PUT", body: JSON.stringify({ termId: sheet.term.id, classId: sheet.class.id, subjectId: sheet.subject.id, entries: Object.entries(edits).map(([studentId, score]) => ({ studentId, score: score === "" ? null : Number(score) })) }) });
      toast("Nilai siswa berhasil disimpan."); setEdits({}); onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "Nilai belum tersimpan."); }
    finally { setBusy(false); }
  }
  return <div className="grade-sheet"><div className="grade-heading"><div><h2>{sheet.class.name} · {sheet.subject.name}</h2><p>{sheet.term.label} · KKM {sheet.subject.kkm}</p></div><span className="pill">{sheet.rows.length} SISWA</span></div>{error && <div className="error-message" role="alert">{error}</div>}<form onSubmit={e => { e.preventDefault(); void save(); }}><div className="table-scroll"><table><thead><tr><th>Siswa</th><th>NIS</th><th>Nilai (0–100)</th><th>Predikat</th><th>Status rapor</th></tr></thead><tbody>{sheet.rows.map(row => <tr key={row.studentId}><td>{row.name}</td><td>{row.nis}</td><td><input aria-label={`Nilai ${row.name}`} type="number" min={0} max={100} step={1} disabled={!!row.blockedReason || busy || (!demo && !me.permissions.includes("reportCards.manage"))} value={edits[row.studentId] ?? row.score ?? ""} onChange={e => setEdits({ ...edits, [row.studentId]: e.target.value })} /></td><td>{row.predicate ?? "—"}</td><td>{row.reportCardStatus ? <Status value={row.reportCardStatus} /> : "Belum dibuat"}</td></tr>)}</tbody></table></div><div className="grade-footer"><span>{Object.keys(edits).length} nilai diubah · Nilai kosong akan dihapus.</span><button className="button primary" disabled={busy || !Object.keys(edits).length}>{busy ? "Menyimpan…" : "Simpan nilai"}<Icon name="check" size={17} /></button></div></form></div>;
}
