"use client";
import { useEffect, useState } from "react";
import { REMINDER_LEAD_MAX, REMINDER_LEAD_MIN } from "@/lib/attendance/reminder-rules";
import { api, scoped } from "@/lib/frontend/api";
import { demoRows } from "@/lib/frontend/demo";
import { isValidLead, reachText, reminderPreview, savedText, type ReminderSettingsView } from "@/lib/frontend/reminder-card-rules";
import { useHub } from "./context";
import { DEMO_MESSAGE, SecurityCard } from "./security-card";

/**
 * Kartu "Pengingat absen" di Pengaturan sekolah (N5): nyala/mati + menit sebelum jam masuk, pratinjau langsung jam kirim,
 * jangkauan notifikasi HP. Dipasang dengan key sekolah+versi agar jadwal yang baru diubah langsung terbaca.
 */
const PATH = "/school/settings/attendance-reminder";

function isSettings(value: unknown): value is ReminderSettingsView {
  const v = value as Partial<ReminderSettingsView> | null;
  return !!v && typeof v.enabled === "boolean" && typeof v.leadMinutes === "number" && typeof v.startMinute === "number" && typeof v.activeStudentCount === "number";
}

function useReminderSettings(version: number) {
  const { demo, schoolId } = useHub();
  const [state, setState] = useState<{ data: ReminderSettingsView | null; error: string }>({ data: null, error: "" });
  useEffect(() => {
    let active = true;
    const load = demo ? Promise.resolve(demoRows(PATH)) : api(scoped(PATH, schoolId)).then(r => r.data);
    load.then(data => { if (active) setState(isSettings(data) ? { data, error: "" } : { data: null, error: "Pengaturan pengingat belum termuat." }); })
      .catch(() => { if (active) setState({ data: null, error: "Pengaturan pengingat belum termuat." }); });
    return () => { active = false; };
  }, [demo, schoolId, version]);
  return state;
}

export function AttendanceReminderCard() {
  const { demo, schoolId, toast } = useHub();
  const [version, setVersion] = useState(0);
  const { data, error } = useReminderSettings(version);
  const [draft, setDraft] = useState<{ enabled: boolean; leadMinutes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  if (error) return <SecurityCard icon="bell" title="Pengingat absen" text={<>{error} <button type="button" className="text-button" onClick={() => setVersion(v => v + 1)}>Coba lagi</button></>} />;
  if (!data) return <section className="security-card"><div className="skeleton" /><div className="skeleton" /></section>;
  const current = draft ?? { enabled: data.enabled, leadMinutes: data.leadMinutes };
  const view: ReminderSettingsView = { ...data, ...current };
  const changed = current.enabled !== data.enabled || current.leadMinutes !== data.leadMinutes;
  async function save() {
    setSaveError("");
    if (demo) { setSaveError(DEMO_MESSAGE); return; }
    setBusy(true);
    try {
      const saved = (await api(scoped(PATH, schoolId), { method: "PUT", body: JSON.stringify(current) })).data;
      toast(isSettings(saved) ? savedText(saved, new Date()) : "Tersimpan.");
      setDraft(null);
      setVersion(v => v + 1);
    } catch (e) { setSaveError(e instanceof Error ? e.message : "Belum tersimpan."); }
    finally { setBusy(false); }
  }
  const text = <>{reminderPreview(view).map(line => <span key={line} className="reminder-line">{line}</span>)}</>;
  return <SecurityCard icon="bell" title="Pengingat absen" text={text}>
    <div className="reminder-form">
      <label className="check-field"><input type="checkbox" checked={current.enabled} onChange={e => setDraft({ ...current, enabled: e.target.checked })} /><span>Kirim pengingat absen</span></label>
      <label className="field reminder-lead">Menit sebelum jam masuk<input type="number" inputMode="numeric" min={REMINDER_LEAD_MIN} max={REMINDER_LEAD_MAX} step={1} disabled={!current.enabled} value={Number.isFinite(current.leadMinutes) ? current.leadMinutes : ""} onChange={e => setDraft({ ...current, leadMinutes: e.target.value === "" ? Number.NaN : Number(e.target.value) })} /></label>
      <button type="button" className="button primary small-button" disabled={busy || !changed || !isValidLead(current.leadMinutes)} onClick={() => void save()}>{busy ? "Menyimpan…" : "Simpan"}</button>
      {saveError && <p className="error-message" role="alert">{saveError}</p>}
    </div>
    <p className="reminder-reach">{reachText(data)}</p>
  </SecurityCard>;
}
