"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { isOwnDialogCancel } from "@/lib/frontend/dialog-events";
import { Icon } from "../icon";

/**
 * Kerangka formulir Akademik. Satu formulir dipakai di dua tempat: di dalam dialog (tab) dan menempel di
 * langkah wizard ("inline"); hanya pembungkus body/footer yang berbeda.
 */
export type FormVariant = "dialog" | "inline";

export function Modal({ eyebrow, title, onClose, busy = false, children }: { eyebrow: string; title: string; onClose: () => void; busy?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); const el = ref.current; return () => el?.close(); }, []);
  return <dialog ref={ref} className="action-dialog acad-dialog" aria-labelledby="acad-dialog-title" onCancel={e => { if (!isOwnDialogCancel(e)) return; e.preventDefault(); if (!busy) onClose(); }}>
    <div className="dialog-heading"><div><span className="eyebrow">{eyebrow}</span><h2 id="acad-dialog-title">{title}</h2></div><button type="button" className="icon-button" aria-label="Tutup" disabled={busy} onClick={onClose}><Icon name="close" /></button></div>
    {children}
  </dialog>;
}

export function FormFrame({ variant, onSubmit, children, footer }: { variant: FormVariant; onSubmit: () => void; children: ReactNode; footer: ReactNode }) {
  return <form className={`acad-form ${variant}`} noValidate onSubmit={e => { e.preventDefault(); onSubmit(); }}>
    <div className={variant === "dialog" ? "dialog-body" : "acad-form-body"}>{children}</div>
    <div className={variant === "dialog" ? "dialog-footer wrap" : "acad-form-footer"}>{footer}</div>
  </form>;
}

interface FooterProps {
  readonly busy: boolean;
  readonly submitLabel: string;
  readonly disabled?: boolean;
  readonly onCancel?: () => void;
  readonly cancelLabel?: string;
  /** Tombol tambahan di kiri (mis. Hapus). */
  readonly extra?: ReactNode;
  /** Sekunder bila langkah wizard sudah punya tombol utama sendiri (mis. "Lanjut"). */
  readonly quiet?: boolean;
}

export function FormFooter({ busy, submitLabel, disabled = false, onCancel, cancelLabel = "Batal", extra, quiet = false }: FooterProps) {
  return <>
    {extra && <span className="acad-footer-extra">{extra}</span>}
    {onCancel && <button type="button" className="button secondary" disabled={busy} onClick={onCancel}>{cancelLabel}</button>}
    <button type="submit" className={`button ${quiet ? "secondary" : "primary"}`} disabled={busy || disabled}>{busy ? "Menyimpan…" : submitLabel}</button>
  </>;
}

/** Galat server/validasi di bawah formulir (role=alert agar dibacakan pembaca layar). */
export function FormError({ text }: { text: string }) {
  return text ? <div className="error-message" role="alert"><Icon name="help" size={18} />{text}</div> : null;
}

/** Satu kalimat sebab-akibat (bukan paragraf). */
export function Why({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" | "success" }) {
  return <p className={`acad-why ${tone}`}><Icon name={tone === "success" ? "check" : tone === "warning" ? "help" : "spark"} size={16} />{children}</p>;
}

/** Konfirmasi hapus dua langkah di dalam formulir (tanpa dialog bertumpuk). */
export function DeleteButton({ label, busy, armed, onArm, onConfirm, blockedReason }: { label: string; busy: boolean; armed: boolean; onArm: () => void; onConfirm: () => void; blockedReason?: string | null }) {
  if (blockedReason) return <span className="acad-delete-blocked"><button type="button" className="button danger-outline small-button" disabled>{label}</button><small>{blockedReason}</small></span>;
  return armed
    ? <button type="button" className="button danger small-button" disabled={busy} onClick={onConfirm}>Ya, {label.toLowerCase()}</button>
    : <button type="button" className="button danger-outline small-button" disabled={busy} onClick={onArm}>{label}</button>;
}
