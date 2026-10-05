"use client";
import { useState, type ReactNode } from "react";
import { accountBadge, loginKindLabel, passwordSummary, shortDateTime, type AccountRow } from "@/lib/frontend/account-rules";
import { initials } from "@/lib/frontend/format";
import { useHub } from "../../context";
import { CopyValue } from "./copy-value";
import { LoginHistoryDialog, ResetPasswordDialog } from "./account-dialogs";

type OpenDialog = "reset" | "history" | null;

function LoginLine({ account }: { account: AccountRow }) {
  const logins = account.logins ?? [];
  if (logins.length > 0) return <>{logins.map(login => <CopyValue key={login.kind} label={loginKindLabel(login.kind)} value={login.value} />)}</>;
  const reason = account.role === "STUDENT" ? `Belum bisa masuk: NISN ${account.student?.nisn ?? ""} belum aktif (siswa draf/nonaktif).` : "Belum ada ID login.";
  return <span className="muted">{reason}</span>;
}

function PasswordLine({ account }: { account: AccountRow }) {
  const summary = passwordSummary(account.password);
  return <div className={`password-state tone-${summary.tone}`}>
    <strong>{summary.title}</strong>
    {summary.plain && <CopyValue label="Kata sandi" value={summary.plain} />}
    {summary.detail && <small>{summary.detail}</small>}
  </div>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="account-fact"><dt>{label}</dt><dd>{children}</dd></div>;
}

/**
 * Satu akun di layar super admin: peran, ID login (bisa disalin), status kata sandi (bawaan siswa tampil apa
 * adanya), terakhir masuk, dan tindakan. `extraActions` = tombol tambahan dari halaman (mis. Masuk sebagai).
 */
export function AccountCard({ account, showSchool = false, onChanged, extraActions }: { account: AccountRow; showSchool?: boolean; onChanged: () => void; extraActions?: ReactNode }) {
  const { me } = useHub();
  const [open, setOpen] = useState<OpenDialog>(null);
  // Akun sendiri: ganti kata sandi lewat Keamanan akun (server menolak reset diri sendiri: USE_CHANGE_PASSWORD).
  const self = account.id === me.user.id;
  return <article className={`account-card${account.isActive ? "" : " inactive"}`}>
    <header className="account-head">
      <span className="avatar table-avatar">{initials(account.name)}</span>
      <div><strong>{account.name}</strong><small>{accountBadge(account)}{showSchool && account.school ? ` · ${account.school.name}` : ""}</small></div>
      {!account.isActive && <span className="status red"><i />Nonaktif</span>}
    </header>
    <dl className="account-facts">
      <Fact label="ID login"><LoginLine account={account} /></Fact>
      <Fact label="Kata sandi"><PasswordLine account={account} /></Fact>
      <Fact label="Terakhir masuk">{account.lastLoginAt ? shortDateTime(account.lastLoginAt) : <span className="muted">Belum pernah</span>}</Fact>
    </dl>
    <div className="account-actions">
      {extraActions}
      <button type="button" className="button secondary small-button" onClick={() => setOpen("history")}>Riwayat masuk</button>
      {!self && <button type="button" className="button secondary small-button" onClick={() => setOpen("reset")}>Reset sandi</button>}
    </div>
    {open === "reset" && <ResetPasswordDialog account={account} onClose={() => setOpen(null)} onDone={onChanged} />}
    {open === "history" && <LoginHistoryDialog account={account} onClose={() => setOpen(null)} />}
  </article>;
}
