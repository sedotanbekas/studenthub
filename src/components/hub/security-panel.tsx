"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import { api } from "@/lib/frontend/api";
import { operations } from "@/lib/frontend/catalog";
import type { Operation } from "@/lib/frontend/types";
import { ActionDialog } from "./action-dialog";
import { useHub } from "./context";
import { Icon } from "./icon";
import { PasswordInput } from "./password-input";

/**
 * Isi atas halaman "Keamanan akun". Tugas wajib (ganti kata sandi awal, aktifkan TOTP) tampil sebagai kartu
 * dengan formulir/tombol TEPAT di bawah pesannya — pengguna tidak perlu mencari di "Tindakan lainnya".
 */
const DEMO_MESSAGE = "Mode demo digunakan untuk menjelajahi formulir. Keluar dari demo dan masuk dengan akun untuk menyimpan data.";

export function SecurityPanel() {
  const { me } = useHub();
  if (me.user.mustChangePassword) {
    return <div className="security-panel"><SecurityCard task icon="key" title="Ganti kata sandi awal" text="Sebelum melanjutkan, buat kata sandi baru untuk mengamankan akunmu."><PasswordForm forced submitLabel="Simpan kata sandi baru" /></SecurityCard></div>;
  }
  if (me.user.totpEnrollmentRequired) return <div className="security-panel"><TotpTask /></div>;
  return <div className="security-panel"><PasswordCard />{me.user.role === "SCHOOL_ADMIN" && <LoginEmailCard />}{me.user.role === "SUPER_ADMIN" && <TrustedDeviceCard />}</div>;
}

interface CardProps { icon: string; title: string; text: ReactNode; task?: boolean; action?: ReactNode; children?: ReactNode }
function SecurityCard({ icon, title, text, task = false, action, children }: CardProps) {
  return <section className={`security-card${task ? " is-task" : ""}`}><div className="security-card-head"><span className="quick-icon tone-0"><Icon name={icon} size={24} /></span><div><h2>{title}</h2><p>{text}</p></div></div>{action}{children}</section>;
}

/** Kirim formulir sebaris: galat tampil di formulir, sukses mengosongkan isian. */
function useInlineSubmit(run: (form: FormData) => Promise<void>) {
  const { demo } = useHub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (demo) { setError(DEMO_MESSAGE); return; }
    const form = event.currentTarget;
    setBusy(true);
    try { await run(new FormData(form)); form.reset(); }
    catch (e) { setError(e instanceof Error ? e.message : "Permintaan gagal."); }
    finally { setBusy(false); }
  }
  return { busy, error, onSubmit };
}

function PasswordForm({ forced = false, submitLabel, onDone }: { forced?: boolean; submitLabel: string; onDone?: () => void }) {
  const { reloadMe, toast } = useHub();
  const { busy, error, onSubmit } = useInlineSubmit(async form => {
    const newPassword = String(form.get("newPassword") ?? "");
    if (newPassword !== String(form.get("confirmPassword") ?? "")) throw new Error("Ulangi kata sandi baru dengan tepat.");
    await api("/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword: form.get("currentPassword"), newPassword }) });
    toast("Kata sandi baru tersimpan."); onDone?.(); await reloadMe();
  });
  return <form className="security-form" onSubmit={onSubmit}>
    <label className="field">{forced ? "Kata sandi awal" : "Kata sandi saat ini"}<PasswordInput name="currentPassword" autoComplete="current-password" required />{forced && <small className="field-hint">Kata sandi yang baru saja kamu pakai untuk masuk.</small>}</label>
    <label className="field">Kata sandi baru<PasswordInput name="newPassword" autoComplete="new-password" minLength={8} required /><small className="field-hint">Minimal 8 karakter, berisi huruf dan angka.</small></label>
    <label className="field">Ulangi kata sandi baru<PasswordInput name="confirmPassword" autoComplete="new-password" minLength={8} required /></label>
    {error && <div className="error-message" role="alert">{error}</div>}
    <button className="button primary" disabled={busy}>{busy ? "Menyimpan…" : submitLabel}<Icon name="arrow" size={18} /></button>
  </form>;
}

function PasswordCard() {
  const [open, setOpen] = useState(false);
  const action = !open && <button type="button" className="button secondary" onClick={() => setOpen(true)}>Ganti kata sandi</button>;
  return <SecurityCard icon="key" title="Kata sandi" text="Perbarui kata sandi secara berkala. Perangkat lain akan dikeluarkan setelah diganti." action={action}>{open && <PasswordForm submitLabel="Simpan kata sandi baru" onDone={() => setOpen(false)} />}</SecurityCard>;
}

/** Admin sekolah: cara masuk (NPSN admin utama) + email login tambahan. */
function LoginEmailCard() {
  const { me, reloadMe, toast } = useHub();
  const [open, setOpen] = useState(false);
  const { busy, error, onSubmit } = useInlineSubmit(async form => {
    await api("/me/email", { method: "PUT", body: JSON.stringify({ email: form.get("email"), currentPassword: form.get("currentPassword") }) });
    toast("Email tersimpan. Sekarang kamu bisa masuk dengan email ini."); setOpen(false); await reloadMe();
  });
  const { email, loginNpsn } = me.user;
  const text = <>{loginNpsn ? <>Masuk dengan NPSN <strong>{loginNpsn}</strong>{email ? <> atau email <strong>{email}</strong></> : ""}.</> : email ? <>Masuk dengan email <strong>{email}</strong>.</> : "Belum ada email login."}{loginNpsn && !email ? " Tambahkan email agar tidak perlu mengingat NPSN." : ""}</>;
  const action = !open && <button type="button" className="button secondary" onClick={() => setOpen(true)}>{email ? "Ubah email login" : "Tambahkan email (bisa untuk login)"}</button>;
  return <SecurityCard icon="mail" title="Cara masuk" text={text} action={action}>{open && <form className="security-form" onSubmit={onSubmit}>
    <label className="field">Email<input name="email" type="email" autoComplete="email" placeholder="nama@sekolah.sch.id" defaultValue={email ?? ""} required /></label>
    <label className="field">Kata sandi saat ini<PasswordInput name="currentPassword" autoComplete="current-password" required /><small className="field-hint">Untuk memastikan ini benar-benar kamu.</small></label>
    {error && <div className="error-message" role="alert">{error}</div>}
    <div className="security-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setOpen(false)}>Batal</button><button className="button primary" disabled={busy}>{busy ? "Menyimpan…" : "Simpan email"}</button></div>
  </form>}</SecurityCard>;
}

/** Super admin: lupakan semua browser yang dicentang "Ingat perangkat ini". */
function TrustedDeviceCard() {
  const { demo, toast } = useHub();
  const [busy, setBusy] = useState(false);
  async function forget() {
    if (demo) { toast(DEMO_MESSAGE); return; }
    setBusy(true);
    try {
      const result = await api("/me/trusted-devices", { method: "DELETE" });
      const removed = Number((result.data as { removed?: number } | null)?.removed ?? 0);
      toast(removed > 0 ? `${removed} perangkat dilupakan. Masuk berikutnya meminta kode autentikator.` : "Belum ada perangkat tepercaya.");
    } catch (e) { toast(e instanceof Error ? e.message : "Permintaan gagal."); }
    finally { setBusy(false); }
  }
  const action = <button type="button" className="button secondary" disabled={busy} onClick={() => void forget()}>{busy ? "Memproses…" : "Lupakan semua perangkat"}</button>;
  return <SecurityCard icon="shield" title="Perangkat tepercaya" text="Browser yang dicentang “Ingat perangkat ini” saat masuk tidak diminta kode autentikator selama 30 hari." action={action} />;
}

/** Super admin wajib TOTP: dua langkah dengan tombolnya masing-masing. */
function TotpTask() {
  const [op, setOp] = useState<Operation | null>(null);
  const step = (id: string) => operations.find(o => o.id === id) ?? null;
  return <SecurityCard task icon="shield" title="Aktifkan autentikasi dua langkah" text="Akun super admin wajib memakai kode dari aplikasi autentikator (Google Authenticator, Authy, dsb.) sebelum melanjutkan.">
    <ol className="task-steps">
      <li><span>Tampilkan rahasia TOTP, lalu tambahkan ke aplikasi autentikator.</span><button type="button" className="button primary" onClick={() => setOp(step("setupMyTotp"))}>Tampilkan rahasia</button></li>
      <li><span>Masukkan kode 6 digit dari aplikasi autentikator.</span><button type="button" className="button secondary" onClick={() => setOp(step("confirmMyTotp"))}>Masukkan kode</button></li>
    </ol>
    {op && <ActionDialog key={op.id} op={op} onClose={() => setOp(null)} onDone={() => undefined} />}
  </SecurityCard>;
}
