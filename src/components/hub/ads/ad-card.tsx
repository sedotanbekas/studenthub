"use client";
import { useState } from "react";
import { initials } from "@/lib/frontend/format";
import { Icon } from "../icon";

/**
 * Kartu iklan "native" yang tenang: banner 2:1 dengan label kecil "Sponsor", nama mitra, judul, dan
 * ajakan halus. Dipakai slot beranda siswa dan pratinjau penempatan (sponsor & super admin) agar
 * yang dilihat pengiklan sama persis dengan yang dilihat siswa.
 */
export interface AdCardData { readonly title: string; readonly imageSrc: string; readonly sponsorName: string }

export function AdCard({ ad, onOpen, busy = false, preview = false }: { ad: AdCardData; onOpen?: () => void; busy?: boolean; preview?: boolean }) {
  const [broken, setBroken] = useState(false);
  const body = <>
    <span className="partner-media">
      {broken
        ? <span className="partner-media-fallback" aria-hidden="true">{initials(ad.sponsorName)}</span>
        // eslint-disable-next-line @next/next/no-img-element -- banner dari /media atau proxy berkas privat; next/image tidak melayani keduanya
        : <img src={ad.imageSrc} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} />}
      <span className="partner-badge">Sponsor</span>
    </span>
    <span className="partner-meta">
      <span className="partner-name"><span className="partner-avatar" aria-hidden="true">{initials(ad.sponsorName).slice(0, 1)}</span>{ad.sponsorName}</span>
      <strong className="partner-headline">{ad.title}</strong>
    </span>
    <span className="partner-action" aria-hidden="true">{busy ? "Membuka…" : "Lihat"}<Icon name="arrow" size={15} /></span>
  </>;
  if (!onOpen || preview) return <div className={`partner-card${preview ? " preview" : ""}`}><div className="partner-card-body">{body}</div></div>;
  return <div className="partner-card"><button type="button" className="partner-card-body" disabled={busy} onClick={onOpen} aria-label={`Sponsor ${ad.sponsorName}: ${ad.title}. Buka tautan mitra di tab baru.`}>{body}</button></div>;
}
