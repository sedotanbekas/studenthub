"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  LATE_REASON_CATEGORIES,
  LATE_REASON_LABELS,
  LATE_REASON_NOTE_MAX,
  lateReasonBodyOf,
  lateReasonDraftState,
  lateReasonNextStep,
  lateReasonNoteLength,
  lateReasonShort,
  lateReasonText,
  type LateReasonAttendance,
  type LateReasonDraft,
  type LateReasonDto,
  type LateReasonValue,
} from "@/lib/attendance/late-reason-rules";
import type { LateReasonResultDto } from "@/lib/attendance/late-reason-schemas";
import { api } from "@/lib/frontend/api";
import { demoSaveLateReason } from "@/lib/frontend/demo";
import { useHub } from "../context";

/**
 * Alasan terlambat (A1): pemilih kategori + keterangan, formulir simpan, panel di kartu hari ini, dan bagian
 * layar "Absensi tercatat". Tidak pernah modal dan tidak pernah wajib: absen tetap tercatat tanpa alasan.
 */
export const EMPTY_LATE_DRAFT: LateReasonDraft = { category: null, note: "" };
/** Batas tunggu simpan alasan otomatis setelah absen (jaringan sekolah bisa lambat). */
const AUTO_SAVE_TIMEOUT_MS = 8_000;

/** Simpan alasan (mode demo: tanpa jaringan, tidak tersimpan). */
export async function saveLateReason(body: LateReasonValue, demo: boolean, signal?: AbortSignal): Promise<LateReasonResultDto> {
  if (demo) return demoSaveLateReason(body, new Date());
  const response = await api("/student/attendance/today/late-reason", { method: "PUT", body: JSON.stringify(body), signal });
  return response.data as LateReasonResultDto;
}

const draftOf = (reason: LateReasonDto | null): LateReasonDraft => (reason ? { category: reason.category, note: reason.note ?? "" } : EMPTY_LATE_DRAFT);
const errorText = (e: unknown): string => (e instanceof DOMException && e.name === "TimeoutError" ? "Koneksi lambat." : e instanceof Error ? e.message : "Alasan belum tersimpan.");

interface PickerProps { readonly draft: LateReasonDraft; readonly onChange: (draft: LateReasonDraft) => void; readonly beforeCheckIn?: boolean }

export function LateReasonPicker({ draft, onChange, beforeCheckIn = false }: PickerProps) {
  const noteId = useId();
  const incomplete = lateReasonDraftState(draft) === "INCOMPLETE";
  return <div className="late-reason-picker">
    <div className="review-chips late-reason-chips" role="radiogroup" aria-label="Alasan terlambat">
      {LATE_REASON_CATEGORIES.map(code => <button key={code} type="button" role="radio" aria-checked={draft.category === code} className="review-chip" onClick={() => onChange({ ...draft, category: code })}>{LATE_REASON_LABELS[code]}</button>)}
    </div>
    <label className="late-reason-note" htmlFor={noteId}><span>{draft.category === "OTHER" ? "Tulis singkat alasannya" : "Keterangan tambahan (opsional)"}</span>
      <textarea id={noteId} rows={2} maxLength={LATE_REASON_NOTE_MAX} value={draft.note} onChange={e => onChange({ ...draft, note: e.target.value })} />
      <small className="muted"><span>Dibaca admin sekolah. Tidak perlu menulis detail kesehatan.</span><span>{lateReasonNoteLength(draft.note)}/{LATE_REASON_NOTE_MAX}</span></small>
    </label>
    {incomplete && <p className="warning-message" role="status">{beforeCheckIn ? "Tulis minimal 5 karakter — atau lewati, absen tetap terkirim." : "Tulis minimal 5 karakter, atau isi nanti."}</p>}
  </div>;
}

interface FormProps { readonly initial: LateReasonDraft; readonly onSaved: (result: LateReasonResultDto) => void; readonly onCancel: () => void }

export function LateReasonForm({ initial, onSaved, onCancel }: FormProps) {
  const { demo } = useHub();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const body = lateReasonBodyOf(draft);
  async function save() {
    if (!body) return;
    setBusy(true); setError("");
    try { onSaved(await saveLateReason(body, demo)); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  return <div className="late-reason-form">
    <LateReasonPicker draft={draft} onChange={setDraft} />
    <div className="late-reason-actions">
      <button type="button" className="button primary small-button" disabled={!body || busy} onClick={() => void save()}>{busy ? "Menyimpan…" : "Simpan alasan"}</button>
      <button type="button" className="button secondary small-button" disabled={busy} onClick={onCancel}>Nanti saja</button>
      {error && <span className="error-message" role="alert">{error}</span>}
    </div>
  </div>;
}

interface PanelProps { readonly reason: LateReasonDto | null; readonly editable: boolean; readonly onSaved: (result: LateReasonResultDto) => void }

/** Baris alasan di kartu "Hari ini": belum diisi -> [Isi alasan]; terisi -> teks + [Ubah] selama masih boleh. */
export function LateReasonPanel({ reason, editable, onSaved }: PanelProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  if (!reason && !editable) return null;
  if (open) return <div className="late-reason-panel"><LateReasonForm initial={draftOf(reason)} onCancel={() => setOpen(false)} onSaved={result => { setOpen(false); setMessage(result.message); onSaved(result); }} /></div>;
  return <div className="late-reason-panel">
    <p className="late-reason-line">{reason ? <>Alasan: <strong>{lateReasonText(reason)}</strong></> : "Alasan terlambat belum diisi."}
      {editable && <button type="button" className="text-button" onClick={() => { setMessage(""); setOpen(true); }}>{reason ? "Ubah" : "Isi alasan"}</button>}</p>
    {message && <p className="success-message" role="status">{message}</p>}
  </div>;
}

type DonePhase = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; reason: LateReasonDto } | { kind: "error"; message: string } | { kind: "later" };

/** Kirim draf yang siap; gagal menyimpan alasan tidak pernah menyentuh absen yang sudah tercatat. */
function useAutoSubmit(attendance: LateReasonAttendance, draft: LateReasonDraft): [DonePhase, (phase: DonePhase) => void, () => void] {
  const { demo } = useHub();
  const [phase, setPhase] = useState<DonePhase>(attendance.lateReason ? { kind: "saved", reason: attendance.lateReason } : { kind: "idle" });
  const started = useRef(false);
  const submit = () => {
    const body = lateReasonBodyOf(draft);
    if (!body) return;
    setPhase({ kind: "saving" });
    saveLateReason(body, demo, AbortSignal.timeout(AUTO_SAVE_TIMEOUT_MS))
      .then(result => setPhase({ kind: "saved", reason: result.lateReason }), (e: unknown) => setPhase({ kind: "error", message: errorText(e) }));
  };
  useEffect(() => {
    if (started.current || lateReasonNextStep(attendance, draft) !== "AUTO_SUBMIT") return;
    started.current = true;
    submit();
  });
  return [phase, setPhase, submit];
}

/** Bagian alasan di layar "Absensi tercatat": menyimpan, tersimpan, gagal + [Coba lagi], atau formulir singkat. */
export function DoneLateReason({ attendance, draft }: { readonly attendance: LateReasonAttendance; readonly draft: LateReasonDraft }) {
  const [phase, setPhase, retry] = useAutoSubmit(attendance, draft);
  if (phase.kind === "saving") return <p className="muted" role="status">Menyimpan alasan…</p>;
  if (phase.kind === "saved") return <p className="success-message" role="status">Alasan: {lateReasonShort(phase.reason)} · tersimpan.</p>;
  if (phase.kind === "error") return <p className="error-message" role="alert">Alasan belum tersimpan: {phase.message}<button type="button" className="text-button" onClick={retry}>Coba lagi</button></p>;
  if (phase.kind === "later") return <p className="muted">Alasan bisa diisi nanti di halaman Absensi, sampai jam sekolah usai.</p>;
  if (lateReasonNextStep(attendance, draft) !== "ASK") return null;
  return <section className="late-reason-done" aria-labelledby="late-reason-done-title">
    <h3 id="late-reason-done-title">Kenapa terlambat?</h3><p className="muted">Opsional · bisa diisi nanti, sampai jam sekolah usai.</p>
    <LateReasonForm initial={draft} onSaved={result => setPhase({ kind: "saved", reason: result.lateReason })} onCancel={() => setPhase({ kind: "later" })} />
  </section>;
}
