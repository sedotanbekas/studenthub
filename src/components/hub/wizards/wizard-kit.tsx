"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, scoped } from "@/lib/frontend/api";
import { demoRows } from "@/lib/frontend/demo";
import { demoPersonaForUser } from "@/lib/frontend/demo-personas";
import { isOwnDialogCancel } from "@/lib/frontend/dialog-events";
import { Why } from "../academics/form-kit";
import { useHub } from "../context";
import { Icon } from "../icon";

/**
 * Kerangka wizard di dalam dialog (impor siswa, tagihan massal, rapor, daftarkan sekolah): bilah langkah di atas,
 * isi langkah dengan satu kalimat sebab-akibat, dan tautan ke formulir lengkap lama untuk kebutuhan lanjutan.
 */
export interface CustomActionProps {
  readonly onClose: () => void;
  /** Data halaman perlu dimuat ulang (dipanggil setelah simpan berhasil). */
  readonly onDone: () => void;
  /** Buka formulir lengkap generik (semua kolom API) sebagai jalan keluar. */
  readonly onFallback?: () => void;
}

export interface StepDef { readonly key: string; readonly title: string }

interface WizardDialogProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly steps: readonly StepDef[];
  readonly index: number;
  /** Langkah terjauh yang boleh dibuka (langkah berikutnya butuh hasil langkah sebelumnya). */
  readonly reachable: number;
  /** Langkah sebelum indeks ini terkunci karena hasilnya sudah tersimpan (mencegah simpan ganda/ubah diam-diam). */
  readonly lockedBefore?: number;
  /** Peringatan tutup dari useCloseGuard, tampil di bawah isi langkah. */
  readonly notice?: ReactNode;
  readonly onStep: (index: number) => void;
  readonly onClose: () => void;
  readonly busy?: boolean;
  readonly fallback?: { label: string; onClick: () => void };
  readonly children: ReactNode;
}

export function WizardDialog({ eyebrow, title, steps, index, reachable, lockedBefore = 0, notice, onStep, onClose, busy = false, fallback, children }: WizardDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); const el = ref.current; return () => el?.close(); }, []);
  return <dialog ref={ref} className="action-dialog wizard-dialog" aria-labelledby="wizard-title" onCancel={(e) => { if (!isOwnDialogCancel(e)) return; e.preventDefault(); if (!busy) onClose(); }}>
    <div className="dialog-heading"><div><span className="eyebrow">{eyebrow}</span><h2 id="wizard-title">{title}</h2></div><button type="button" className="icon-button" aria-label="Tutup" disabled={busy} onClick={onClose}><Icon name="close" /></button></div>
    <ol className="wizard-steps-bar">{steps.map((step, i) => <li key={step.key}>
      <button type="button" className={i < index ? "done" : i === index ? "current" : ""} aria-current={i === index ? "step" : undefined} disabled={busy || i > reachable || i < lockedBefore} onClick={() => onStep(i)}>
        <span className="step-mark" aria-hidden="true">{i < index ? "✓" : i + 1}</span><span>{step.title}</span>
      </button>
    </li>)}</ol>
    <div className="dialog-body wizard-dialog-body">{children}{notice}</div>
    {fallback && <div className="wizard-fallback"><button type="button" className="text-button" disabled={busy} onClick={fallback.onClick}>{fallback.label}</button></div>}
  </dialog>;
}

/** Judul langkah + satu kalimat kenapa/akibatnya. */
export function StepIntro({ title, why, tone }: { title: string; why: ReactNode; tone?: "info" | "warning" | "success" }) {
  return <div className="wizard-step-intro"><h3>{title}</h3><Why tone={tone}>{why}</Why></div>;
}

/** Baris tombol bawah langkah: kiri kembali, kanan aksi utama. */
export function StepActions({ back, children }: { back?: () => void; children: ReactNode }) {
  return <div className="wizard-actions">{back && <button type="button" className="text-button wizard-back" onClick={back}><Icon name="back" size={15} />Kembali</button>}<span className="wizard-actions-main">{children}</span></div>;
}

export const DEMO_BLOCKED = "Mode demo hanya untuk melihat-lihat, jadi tidak ada yang disimpan. Masuk dengan akun asli untuk menyimpan.";

type Method = "POST" | "PUT" | "PATCH";

/** Akses API wizard: mode demo membaca data contoh dan menolak penyimpanan dengan pesan jelas. */
export function useWizardApi(): { demo: boolean; get: <T>(path: string) => Promise<T>; send: <T>(path: string, method: Method, body: unknown) => Promise<T> } {
  const { schoolId, demo, me } = useHub();
  const get = useCallback(async <T,>(path: string): Promise<T> => {
    if (demo) return demoRows(path.split("?")[0] ?? path, demoPersonaForUser(me.user.id)) as T;
    return (await api(scoped(path, schoolId))).data as T;
  }, [demo, me.user.id, schoolId]);
  const send = useCallback(async <T,>(path: string, method: Method, body: unknown): Promise<T> => {
    if (demo) throw new ApiError(DEMO_BLOCKED, "DEMO");
    const payload = body instanceof FormData ? body : JSON.stringify(body);
    return (await api(scoped(path, schoolId), { method, body: payload })).data as T;
  }, [demo, schoolId]);
  return { demo, get, send };
}

/** Simpan teks sebagai berkas unduhan (mis. CSV kata sandi awal). */
export function saveTextFile(text: string, filename: string, type = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Penjaga tutup: bila menutup akan menghilangkan sesuatu (kata sandi yang hanya tampil sekali, akun admin yang belum
 * dibuat), tutup pertama memunculkan peringatan di dalam dialog alih-alih langsung menutup.
 */
export function useCloseGuard(onClose: () => void, warning: string | null): { request: () => void; notice: ReactNode } {
  const [confirming, setConfirming] = useState(false);
  const request = () => { if (warning) setConfirming(true); else onClose(); };
  const notice = confirming && warning ? <CloseWarning text={warning} onStay={() => setConfirming(false)} onLeave={onClose} /> : null;
  return { request, notice };
}

function CloseWarning({ text, onStay, onLeave }: { text: string; onStay: () => void; onLeave: () => void }) {
  const stay = useRef<HTMLButtonElement>(null);
  useEffect(() => { stay.current?.focus(); }, []);
  return <div className="danger-confirm wizard-close-warning" role="alertdialog" aria-labelledby="close-warning-title" aria-describedby="close-warning-text">
    <strong id="close-warning-title">Tutup panduan?</strong>
    <p id="close-warning-text">{text}</p>
    <div className="confirm-buttons">
      <button ref={stay} type="button" className="button secondary small-button" onClick={onStay}>Kembali</button>
      <button type="button" className="button danger small-button" onClick={onLeave}>Tetap tutup</button>
    </div>
  </div>;
}
