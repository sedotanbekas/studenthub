"use client";
import { useEffect, useState } from "react";
import { IMPERSONATION_RETURN_KEY, impersonationReturnPath, remainingMs, remainingText } from "@/lib/frontend/impersonation-view";
import { roleLabels } from "@/lib/frontend/modules";
import type { Identity } from "@/lib/frontend/types";
import { Icon } from "./icon";

const TICK_MS = 1000;

/**
 * Akhiri "Masuk sebagai": proxy web mencabut sesi akun yang dibuka lalu memulihkan sesi super admin; halaman dimuat
 * ulang penuh agar seluruh keadaan akun yang dibuka hilang. Gagal jaringan tetap memuat ulang: banner muncul lagi
 * selama sesi itu masih hidup sehingga bisa diulang.
 */
export async function endImpersonation(): Promise<void> {
  const target = impersonationReturnPath();
  await fetch("/api/web/auth/impersonation/end", { method: "POST", cache: "no-store" }).catch(() => null);
  try { sessionStorage.removeItem(IMPERSONATION_RETURN_KEY); } catch { /* sessionStorage diblokir: tidak ada yang perlu dihapus */ }
  window.location.assign(target);
}

/** Pita peringatan selama super admin memakai akun lain: siapa, sisa waktu, dan tombol kembali. Habis = kembali otomatis. */
export function ImpersonationBanner({ me }: { me: Identity }) {
  const impersonation = me.impersonation ?? null;
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), TICK_MS); return () => clearInterval(timer); }, []);
  const expired = impersonation !== null && remainingMs(impersonation.expiresAt, now) === 0;
  useEffect(() => { if (expired) void endImpersonation(); }, [expired]);
  if (!impersonation) return null;
  const exit = () => { setBusy(true); void endImpersonation(); };
  return <div className="demo-banner impersonation-banner">
    <Icon name="shield" size={16} />
    <p className="impersonation-text">Kamu masuk sebagai <strong>{me.user.name}</strong> ({roleLabels[me.user.role]}) · mode lihat · sisa {remainingText(impersonation.expiresAt, now)}</p>
    <button type="button" className="button secondary small-button" disabled={busy} onClick={exit}>{busy ? "Kembali…" : "Kembali ke super admin"}</button>
  </div>;
}
