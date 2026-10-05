"use client";
import { useState } from "react";
import { useHub } from "../../context";
import { Icon } from "../../icon";

/** Nilai yang bisa disalin satu klik (ID login, kata sandi bawaan) — untuk verifikasi keluhan tester. */
export function CopyValue({ label, value }: { label: string; value: string }) {
  const { toast } = useHub();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast(`${label} disalin.`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast(`Tidak dapat menyalin otomatis. Salin ${label.toLowerCase()} secara manual.`);
    }
  }
  return <span className="copy-value">
    <span className="copy-label">{label}</span>
    <code>{value}</code>
    <button type="button" className="icon-button copy-button" aria-label={`Salin ${label}`} onClick={copy}><Icon name={copied ? "check" : "copy"} size={15} /></button>
  </span>;
}
