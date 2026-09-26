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
    <span className="ad-media">
      {broken
        ? <span className="ad-media-fallback" aria-hidden="true">{initials(ad.sponsorName)}</span>
        // eslint-disable-next-line @next/next/no-img-element -- banner dari /media atau proxy berkas privat; next/image tidak melayani keduanya
        : <img src={ad.imageSrc} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} />}
      <span className="ad-badge">Sponsor</span>
    </span>
    <span className="ad-meta">
      <span className="ad-sponsor"><span className="ad-avatar" aria-hidden="true">{initials(ad.sponsorName).slice(0, 1)}</span>{ad.sponsorName}</span>
      <strong className="ad-title">{ad.title}</strong>
    </span>
    <span className="ad-cta" aria-hidden="true">{busy ? "Membuka…" : "Lihat"}<Icon name="arrow" size={15} /></span>
  </>;
  if (!onOpen || preview) return <div className={`ad-card${preview ? " preview" : ""}`}><div className="ad-card-body">{body}</div></div>;
  return <div className="ad-card"><button type="button" className="ad-card-body" disabled={busy} onClick={onOpen} aria-label={`Sponsor ${ad.sponsorName}: ${ad.title}. Buka tautan mitra di tab baru.`}>{body}</button></div>;
}
