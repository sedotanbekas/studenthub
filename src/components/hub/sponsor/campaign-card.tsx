"use client";
import { useId, useState } from "react";
import type { AdDto, AdPerformanceDto } from "@/lib/frontend/ad-types";
import { scheduleRange, statusTone, targetSummary } from "@/lib/frontend/campaign-rules";
import { initials, label, number, rupiah } from "@/lib/frontend/format";
import { Icon } from "../icon";

/** Pill status kampanye (label dari kamus enum, nada dari aturan kampanye; titik + teks, bukan hanya warna). */
export function CampaignStatus({ status }: { status: AdDto["displayStatus"] }) {
  return <span className={`status ${statusTone(status)}`}><i />{label(status)}</span>;
}

/** Thumbnail banner 2:1; berkas rusak/terhapus -> inisial sponsor. */
export function BannerThumb({ src, fallback, className = "campaign-thumb" }: { src: string; fallback: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  return <span className={className}>
    {broken
      ? <span className="thumb-fallback" aria-hidden="true">{initials(fallback)}</span>
      // eslint-disable-next-line @next/next/no-img-element -- banner dari /media, proxy berkas privat, atau object URL lokal; next/image tidak melayani ketiganya
      : <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} />}
  </span>;
}

interface CardProps {
  readonly ad: AdDto;
  readonly src: string;
  readonly sponsorName: string;
  readonly performance: AdPerformanceDto | undefined;
  readonly today: string;
  readonly onOpen: () => void;
}

export function CampaignCard({ ad, src, sponsorName, performance, today, onOpen }: CardProps) {
  const titleId = useId();
  const metaId = useId();
  const statusId = useId();
  return <li className={`campaign-item tone-${statusTone(ad.displayStatus)}`}>
    <button type="button" className="campaign-card" onClick={onOpen} aria-labelledby={titleId} aria-describedby={`${statusId} ${metaId}`}>
      <BannerThumb key={src} src={src} fallback={sponsorName} />
      <span className="campaign-body">
        <span className="campaign-head" id={statusId}><CampaignStatus status={ad.displayStatus} /><span className="campaign-open" aria-hidden="true"><Icon name="chevron" size={18} /></span></span>
        <strong className="campaign-title" id={titleId}>{ad.title}</strong>
        <span className="campaign-meta" id={metaId}>
          <span><Icon name="calendar" size={16} />{scheduleRange(ad.startAt, ad.endAt, today)}</span>
          <span><Icon name="location" size={16} />{targetSummary(ad.targetScope, ad.targets)}</span>
          <span><Icon name="wallet" size={16} />{rupiah(ad.cpcAmount)} per klik</span>
        </span>
        <CardPerformance performance={performance} />
      </span>
    </button>
    {ad.displayStatus === "REJECTED" && ad.reviewNote && <p className="campaign-note"><b>Catatan peninjau:</b> {ad.reviewNote}</p>}
  </li>;
}

function CardPerformance({ performance }: { performance: AdPerformanceDto | undefined }) {
  if (!performance || performance.impressions === 0) return null;
  return <span className="campaign-perf">
    <span><b>{number(performance.impressions)}</b> tayangan</span>
    <span><b>{number(performance.clicks)}</b> klik</span>
    <small>7 hari terakhir</small>
  </span>;
}
