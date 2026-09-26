"use client";
import { useState } from "react";
import type { PlatformTopUpDto } from "@/lib/frontend/ad-types";
import { fileSrc } from "@/lib/frontend/ad-media";
import { rupiah } from "@/lib/frontend/format";
import { calendarDate, shortRef, timeAgo, wibDateTime } from "@/lib/frontend/review-rules";
import { Status } from "../data-view";
import { Icon } from "../icon";
import { Fact } from "./review-layout";

/**
 * Detail top-up untuk diverifikasi: bukti transfer besar (klik = ukuran penuh di tab baru), nominal,
 * data transfer, saldo sponsor sekarang → setelah disetujui, peringatan bukti ganda, dan keputusan.
 * Setujui wajib centang "nominal pada bukti sesuai" — nominal dikreditkan persis.
 */

interface TopUpDetailProps {
  readonly topUp: PlatformTopUpDto;
  readonly now: Date;
  readonly busy: boolean;
  readonly error: string;
  readonly onApprove: () => void;
  readonly onReject: () => void;
}

export function TopUpDetail({ topUp, now, busy, error, onApprove, onReject }: TopUpDetailProps) {
  return <article className="review-detail" aria-labelledby="review-topup-title">
    <header className="review-detail-head">
      <div className="review-detail-meta"><Status value={topUp.status} /><span>Diajukan {timeAgo(topUp.createdAt, now)}</span></div>
      <h2 id="review-topup-title" className="review-amount">{rupiah(topUp.amount)}</h2>
      <p>Top-up saldo <strong>{topUp.sponsor.companyName}</strong></p>
    </header>
    <div className="review-detail-body">
      {topUp.duplicateProofOf.length > 0 && <DuplicateWarning ids={topUp.duplicateProofOf} />}
      <div className="review-detail-grid proof">
        <ProofImage topUp={topUp} />
        <div className="review-side">
          <dl className="review-facts">
            <Fact label="Tanggal transfer">{calendarDate(topUp.transferDate)}</Fact>
            <Fact label="Bank pengirim">{topUp.senderBank}</Fact>
            <Fact label="Nama pengirim" wide>{topUp.senderName}</Fact>
            <Fact label="Catatan sponsor" wide>{topUp.note ?? "—"}</Fact>
            <Fact label="Diajukan" wide>{wibDateTime(topUp.createdAt)}</Fact>
          </dl>
          <SponsorBalance topUp={topUp} />
        </div>
      </div>
      {topUp.reviewNote && <div className="review-note"><span className="eyebrow">Catatan peninjau</span><p>{topUp.reviewNote}</p>{topUp.reviewedAt && <small>{wibDateTime(topUp.reviewedAt)}</small>}</div>}
    </div>
    {topUp.status === "PENDING" && <TopUpActions key={topUp.id} amount={topUp.amount} busy={busy} error={error} onApprove={onApprove} onReject={onReject} />}
  </article>;
}

function ProofImage({ topUp }: { topUp: PlatformTopUpDto }) {
  const src = fileSrc(topUp.proofFileId);
  return <figure className="review-proof">
    <a href={src} target="_blank" rel="noopener noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element -- bukti transfer privat lewat proxy sesi /api/web/files; next/image tidak dapat meneruskan sesi */}
      <img src={src} alt={`Bukti transfer ${rupiah(topUp.amount)} dari ${topUp.senderName}`} decoding="async" />
      <span className="sr-only"> (buka ukuran penuh di tab baru)</span>
      <span className="review-proof-hint" aria-hidden="true"><Icon name="eye" size={16} />Ukuran penuh</span>
    </a>
    <figcaption>Cocokkan nominal, tanggal, dan nama pengirim dengan data pengajuan.</figcaption>
  </figure>;
}

function SponsorBalance({ topUp }: { topUp: PlatformTopUpDto }) {
  const { sponsor, amount } = topUp;
  return <div className="review-balance">
    <span className="review-sponsor"><strong>{sponsor.companyName}</strong><Status value={sponsor.status} /></span>
    <div className="review-balance-flow">
      <span><small>Saldo sekarang</small><strong>{rupiah(sponsor.balance)}</strong></span>
      {topUp.status === "PENDING" && <>
        <span className="review-balance-arrow" aria-hidden="true"><Icon name="arrow" size={18} /></span>
        <span><small>Setelah disetujui</small><strong className="review-good">{rupiah(sponsor.balance + amount)}</strong></span>
      </>}
    </div>
  </div>;
}

function DuplicateWarning({ ids }: { ids: readonly string[] }) {
  return <div className="warning-message" role="note">
    <Icon name="shield" size={19} />
    <span><strong>Bukti transfer identik</strong> dengan {ids.length} pengajuan lain ({ids.map(shortRef).join(", ")}). Pastikan bukti ini bukan dipakai ulang sebelum menyetujui.</span>
  </div>;
}

function TopUpActions({ amount, busy, error, onApprove, onReject }: { amount: number; busy: boolean; error: string; onApprove: () => void; onReject: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  return <footer className="review-actions">
    {error && <div className="error-message" role="alert">{error}</div>}
    <label className="check-field review-confirm">
      <input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />
      <span>Nominal pada bukti sesuai {rupiah(amount)}<small>Cocokkan juga tanggal transfer dan nama pengirim.</small></span>
    </label>
    <div className="review-buttons">
      <button type="button" className="button danger-outline" disabled={busy} onClick={onReject}>Tolak</button>
      <button type="button" className="button primary" disabled={busy || !confirmed} onClick={onApprove}>{busy ? "Memproses…" : "Setujui"}</button>
    </div>
  </footer>;
}
