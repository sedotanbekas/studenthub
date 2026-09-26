"use client";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { hasQuickReason, REASON_MAX, reasonError, toggleQuickReason } from "@/lib/frontend/review-rules";
import { Icon } from "../icon";
import { useModalDialog } from "./review-dialog-focus";
import { errorText } from "./review-hooks";

/**
 * Dialog keputusan peninjau: konfirmasi ringan (setujui iklan) atau keputusan beralasan (tolak,
 * turunkan, tolak top-up) dengan chip alasan cepat. Alasan 5..255 karakter dikirim ke sponsor.
 */

export interface ReasonConfig { readonly label: string; readonly chips: readonly string[]; readonly hint: string; readonly placeholder: string }
export interface DecisionConfig {
  readonly eyebrow: string;
  readonly title: string;
  readonly intro: ReactNode;
  readonly confirmLabel: string;
  readonly tone: "primary" | "danger";
  readonly reason?: ReasonConfig;
}

interface DecisionDialogProps {
  readonly config: DecisionConfig;
  /** Selesai = induk menutup dialog; lempar galat = pesan tampil di dialog. */
  readonly onSubmit: (reason: string) => Promise<void>;
  readonly onClose: () => void;
}

export function DecisionDialog({ config, onSubmit, onClose }: DecisionDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [text, setText] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useModalDialog(dialog);
  const invalid = config.reason ? reasonError(text) : null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTried(true);
    if (invalid) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(text.trim());
    } catch (e) {
      setError(errorText(e, "Keputusan belum tersimpan. Silakan coba lagi."));
      setBusy(false);
    }
  }
  const close = () => { if (!busy) onClose(); };
  /**
   * Escape berulang tanpa interaksi lain dapat menutup <dialog> tanpa event cancel. Saat memproses,
   * buka lagi agar hasil/galat tetap terlihat; selain itu samakan state induk (dialog dilepas).
   */
  const onNativeClose = () => {
    const element = dialog.current;
    if (!element || element.open || !element.isConnected) return;
    if (busy) element.showModal();
    else onClose();
  };
  return <dialog ref={dialog} className="action-dialog review-decision" aria-labelledby={titleId} aria-busy={busy || undefined} onCancel={e => { e.preventDefault(); close(); }} onClose={onNativeClose}>
    <form onSubmit={submit} noValidate>
      <div className="dialog-heading"><div><span className="eyebrow">{config.eyebrow}</span><h2 id={titleId}>{config.title}</h2></div><button type="button" className="icon-button" aria-label="Tutup" disabled={busy} onClick={close}><Icon name="close" /></button></div>
      <div className="dialog-body">
        {config.intro}
        {config.reason && <ReasonField config={config.reason} value={text} onChange={setText} error={tried || text.trim().length > REASON_MAX ? invalid : null} />}
        {error && <div className="error-message" role="alert">{error}</div>}
      </div>
      <div className="dialog-footer">
        <button type="button" className="button secondary" disabled={busy} onClick={close}>Batal</button>
        <button type="submit" className={`button ${config.tone}`} disabled={busy}>{busy ? "Memproses…" : config.confirmLabel}</button>
      </div>
    </form>
  </dialog>;
}

function ReasonField({ config, value, onChange, error }: { config: ReasonConfig; value: string; onChange: (value: string) => void; error: string | null }) {
  const id = useId();
  const length = value.trim().length;
  return <div className="review-reason">
    <div className="review-chips" role="group" aria-label="Alasan cepat">
      {config.chips.map(chip => {
        const on = hasQuickReason(value, chip);
        return <button key={chip} type="button" className="review-chip" aria-pressed={on} onClick={() => onChange(toggleQuickReason(value, chip))}>{on && <Icon name="check" size={15} />}{chip}</button>;
      })}
    </div>
    <label className="field" htmlFor={id}>{config.label}</label>
    <textarea id={id} rows={4} value={value} placeholder={config.placeholder} aria-invalid={error ? true : undefined} aria-describedby={`${id}-hint`} onChange={e => onChange(e.target.value)} />
    <div className="review-reason-meta">
      <span id={`${id}-hint`} className={error ? "field-error" : "field-hint"} role={error ? "alert" : undefined}>{error ?? config.hint}</span>
      <span className={length > REASON_MAX ? "field-error" : "muted"}>{length}/{REASON_MAX}</span>
    </div>
  </div>;
}
