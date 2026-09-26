"use client";
import { useState } from "react";
import type { SponsorBalanceDto } from "@/lib/frontend/ad-types";
import { useHub } from "../context";
import { Icon } from "../icon";

/** Rekening tujuan top-up dengan tombol "Salin" (nomor tanpa spasi agar siap ditempel di aplikasi bank). */
export function AccountCard({ account }: { account: SponsorBalanceDto["topUpAccount"] }) {
  const { toast } = useHub();
  const [copied, setCopied] = useState(false);
  if (!account) {
    return <div className="account-card is-empty">
      <span className="account-icon" aria-hidden="true"><Icon name="wallet" size={22} /></span>
      <div><strong>Rekening belum diatur admin</strong><p>Top-up dibuka setelah admin Student Hub mengatur rekening tujuan.</p></div>
    </div>;
  }
  const number = account.accountNumber;
  async function copy() {
    try {
      await navigator.clipboard.writeText(number.replace(/\s+/g, ""));
      setCopied(true);
      toast("Nomor rekening disalin.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Tidak dapat menyalin otomatis. Salin nomor rekening secara manual.");
    }
  }
  return <div className="account-card">
    <span className="kicker">Transfer ke</span>
    <span className="account-bank">{account.bankName}</span>
    <div className="account-row">
      <strong className="account-number">{number}</strong>
      <button type="button" className="button secondary small-button" onClick={() => void copy()} aria-label={`Salin nomor rekening ${number}`}>
        <Icon name={copied ? "check" : "report"} size={17} />{copied ? "Tersalin" : "Salin"}
      </button>
    </div>
    <span className="account-holder">a.n. {account.accountHolder}</span>
  </div>;
}
