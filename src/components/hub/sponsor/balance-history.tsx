"use client";
import { useState } from "react";
import type { TopUpDto } from "@/lib/frontend/ad-types";
import { fileSrc } from "@/lib/frontend/ad-media";
import { longDate } from "@/lib/frontend/campaign-rules";
import { rupiah } from "@/lib/frontend/format";
import { useHub } from "../context";
import { Status } from "../data-view";
import { cancelTopUp } from "./balance-data";
import { failureOf, type SponsorStatus } from "./campaign-data";

/**
 * Riwayat pengajuan top-up: status, bukti (thumbnail), alasan penolakan, dan pembatalan yang masih menunggu.
 * Akun ditangguhkan hanya baca (policy menolak pembatalan), jadi tombol "Batalkan" tidak ditampilkan.
 */
interface HistoryProps {
  readonly topUps: readonly TopUpDto[];
  readonly localProofs: Readonly<Record<string, string>>;
  readonly sponsorStatus: SponsorStatus | null;
  readonly onChanged: (topUp: TopUpDto) => void;
}

export function TopUpHistory({ topUps, localProofs, sponsorStatus, onChanged }: HistoryProps) {
  const canCancel = sponsorStatus !== "SUSPENDED";
  return <section className="panel topup-history" aria-labelledby="topup-history-title">
    <div className="panel-heading"><div><h2 id="topup-history-title">Riwayat top-up</h2><p>Pengajuan terbaru di atas. Bukti hanya bisa dilihat Anda dan admin.</p></div></div>
    {topUps.length === 0
      ? <p className="muted">Belum ada pengajuan top-up.</p>
      : <ul className="topup-list">{topUps.map(t => <TopUpRow key={t.id} topUp={t} proof={localProofs[t.id] ?? fileSrc(t.proofFileId)} canCancel={canCancel} onChanged={onChanged} />)}</ul>}
  </section>;
}

function TopUpRow({ topUp, proof, canCancel, onChanged }: { topUp: TopUpDto; proof: string; canCancel: boolean; onChanged: (t: TopUpDto) => void }) {
  const { demo, toast } = useHub();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function cancel() {
    setBusy(true); setError("");
    try {
      onChanged(await cancelTopUp(topUp, demo));
      toast(demo ? "Mode demo: pengajuan dibatalkan (simulasi)." : "Pengajuan top-up dibatalkan.");
    } catch (e) { setError(failureOf(e).message); setConfirming(false); } finally { setBusy(false); }
  }
  return <li className="topup-row">
    <a className="proof-thumb" href={proof} target="_blank" rel="noopener noreferrer" aria-label={`Lihat bukti transfer ${rupiah(topUp.amount)}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- bukti transfer privat lewat proxy sesi / aset demo; next/image tidak melayaninya */}
      <img src={proof} alt="" loading="lazy" />
    </a>
    <div className="topup-info">
      <div className="topup-top"><strong>{rupiah(topUp.amount)}</strong><Status value={topUp.status} /></div>
      <span className="muted">Transfer {longDate(topUp.transferDate)} · {topUp.senderBank} · {topUp.senderName}</span>
      {topUp.note && <span className="topup-note">{topUp.note}</span>}
      {topUp.status === "REJECTED" && topUp.reviewNote && <p className="topup-review"><b>Alasan penolakan:</b> {topUp.reviewNote}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      {topUp.status === "PENDING" && canCancel && (confirming
        ? <div className="confirm-inline" role="group" aria-label="Konfirmasi pembatalan">
          <span>Batalkan pengajuan ini?</span>
          <button type="button" className="button danger small-button" disabled={busy} onClick={() => void cancel()}>{busy ? "Membatalkan…" : "Ya, batalkan"}</button>
          <button type="button" className="button secondary small-button" disabled={busy} onClick={() => setConfirming(false)}>Tidak</button>
        </div>
        : <button type="button" className="text-button" onClick={() => setConfirming(true)}>Batalkan</button>)}
    </div>
  </li>;
}
