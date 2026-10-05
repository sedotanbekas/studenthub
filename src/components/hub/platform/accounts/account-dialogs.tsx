"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { resetRequest, shortDateTime, type AccountRow } from "@/lib/frontend/account-rules";
import { api } from "@/lib/frontend/api";
import { isOwnDialogCancel } from "@/lib/frontend/dialog-events";
import { display } from "@/lib/frontend/format";
import { useHub } from "../../context";
import { Icon } from "../../icon";
import { useModalDialog } from "../review-dialog-focus";
import { errorText } from "../review-hooks";
import { CopyValue } from "./copy-value";

/** Kerangka dialog akun: judul + isi + tombol bawah; Escape/tutup dicegah selama memproses. */
function AccountDialog({ eyebrow, title, busy = false, onClose, footer, children }: { eyebrow: string; title: string; busy?: boolean; onClose: () => void; footer: ReactNode; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useModalDialog(dialog);
  const close = () => { if (!busy) onClose(); };
  return <dialog ref={dialog} className="action-dialog account-dialog" aria-labelledby={titleId} aria-busy={busy || undefined} onCancel={e => { if (!isOwnDialogCancel(e)) return; e.preventDefault(); close(); }}>
    <div className="dialog-heading"><div><span className="eyebrow">{eyebrow}</span><h2 id={titleId}>{title}</h2></div><button type="button" className="icon-button" aria-label="Tutup" disabled={busy} onClick={close}><Icon name="close" /></button></div>
    <div className="dialog-body">{children}</div>
    <div className="dialog-footer">{footer}</div>
  </dialog>;
}

/** Reset kata sandi lalu tampilkan kata sandi baru apa adanya (bawaan siswa / sementara acak) agar bisa disalin. */
export function ResetPasswordDialog({ account, onClose, onDone }: { account: AccountRow; onClose: () => void; onDone: () => void }) {
  const { demo } = useHub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<string | null>(null);
  async function reset() {
    if (demo) { setError("Mode demo: reset kata sandi hanya bisa dilakukan dengan akun sungguhan."); return; }
    setBusy(true); setError("");
    try {
      const request = resetRequest(account);
      const response = await api(request.path, { method: "POST", ...(request.body ? { body: request.body } : {}) });
      setResult(String((response.data as { temporaryPassword?: string } | null)?.temporaryPassword ?? ""));
    } catch (e) {
      setError(errorText(e, "Kata sandi belum berhasil di-reset. Silakan coba lagi."));
    } finally { setBusy(false); }
  }
  // Daftar dimuat ulang SETELAH dialog ditutup agar kata sandi baru sempat dibaca & disalin.
  const finish = () => { onClose(); if (result !== null) onDone(); };
  const footer = result !== null
    ? <button type="button" className="button primary" onClick={finish}>Selesai</button>
    : <><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Batal</button><button type="button" className="button danger" disabled={busy} onClick={reset}>{busy ? "Memproses…" : "Reset kata sandi"}</button></>;
  return <AccountDialog eyebrow="KELOLA AKUN" title={`Reset kata sandi ${account.name}`} busy={busy} onClose={finish} footer={footer}>
    {result === null
      ? <p>Kata sandi lama tidak berlaku lagi dan <strong>semua perangkat yang sedang masuk akan dikeluarkan</strong>. Pengguna wajib mengganti kata sandi baru saat masuk.</p>
      : <div className="success-message"><Icon name="check" size={19} /><span>Berhasil. {result ? <>Kata sandi baru: <CopyValue label="Kata sandi" value={result} /></> : "Kata sandi baru sudah ditetapkan."}</span></div>}
    {error && <div className="error-message" role="alert">{error}</div>}
  </AccountDialog>;
}

interface LoginEventRow { id: string; occurredAt: string; status: "SUCCESS" | "FAILED"; failureReason: string | null; device: string; location: string | null; ipAddress: string | null; isNewDevice: boolean }

function useLoginHistory(userId: string): { rows: LoginEventRow[] | null; error: string } {
  const { demo } = useHub();
  const [state, setState] = useState<{ rows: LoginEventRow[] | null; error: string }>({ rows: null, error: "" });
  useEffect(() => {
    let active = true;
    const load = demo ? Promise.resolve([] as LoginEventRow[]) : api(`/platform/login-history?userId=${encodeURIComponent(userId)}&limit=20`).then(r => (r.data ?? []) as LoginEventRow[]);
    load.then(rows => { if (active) setState({ rows, error: "" }); }).catch(e => { if (active) setState({ rows: [], error: errorText(e, "Riwayat masuk belum berhasil dimuat.") }); });
    return () => { active = false; };
  }, [userId, demo]);
  return state;
}

function LoginEventItem({ event }: { event: LoginEventRow }) {
  const ok = event.status === "SUCCESS";
  return <li className={`login-event ${ok ? "ok" : "failed"}`}>
    <span className={`status ${ok ? "green" : "red"}`}><i />{ok ? "Berhasil" : `Gagal · ${display(event.failureReason ?? "OTHER")}`}</span>
    <strong>{shortDateTime(event.occurredAt)}</strong>
    <small>{event.device}{event.isNewDevice ? " · perangkat baru" : ""}</small>
    <small>{[event.location, event.ipAddress].filter(Boolean).join(" · ") || "Lokasi tidak diketahui"}</small>
  </li>;
}

/** 20 percobaan masuk terakhir satu akun (berhasil & gagal beserta alasannya). */
export function LoginHistoryDialog({ account, onClose }: { account: AccountRow; onClose: () => void }) {
  const { rows, error } = useLoginHistory(account.id);
  return <AccountDialog eyebrow="RIWAYAT MASUK" title={account.name} onClose={onClose} footer={<button type="button" className="button secondary" onClick={onClose}>Tutup</button>}>
    {error && <div className="error-message" role="alert">{error}</div>}
    {rows === null ? <div className="table-loading" role="status" aria-label="Memuat riwayat masuk"><div className="skeleton" /><div className="skeleton" /></div>
      : rows.length === 0 ? <p className="muted">Belum ada percobaan masuk yang tercatat. Riwayat semua peran dicatat sejak 5 Okt 2026.</p>
        : <ul className="login-events">{rows.map(event => <LoginEventItem key={event.id} event={event} />)}</ul>}
    <p className="field-hint">Lokasi adalah perkiraan dari IP (IP Geolocation by <a href="https://db-ip.com" target="_blank" rel="noreferrer">DB-IP</a>), bukan GPS.</p>
  </AccountDialog>;
}
