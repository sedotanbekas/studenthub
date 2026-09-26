"use client";
import { AdCard, type AdCardData } from "./ad-card";

/**
 * Pratinjau penempatan: tiruan layar HP beranda siswa (kartu identitas, menu, slot mitra, pengumuman)
 * dengan kartu iklan ASLI di posisinya. Menjawab "iklan saya tampil di mana dan seperti apa?".
 */
export function PlacementPreview({ ad, caption = true }: { ad: AdCardData; caption?: boolean }) {
  return <figure className="placement-preview">
    <div className="phone" aria-hidden="true">
      <div className="phone-screen">
        <div className="pp-bar"><span className="pp-logo" /><span className="pp-line w40" /><span className="pp-dot" /></div>
        <div className="pp-idcard"><span className="pp-line w50 light" /><span className="pp-line w30 light" /><span className="pp-clock" /></div>
        <div className="pp-tiles">{Array.from({ length: 6 }, (_, i) => <span key={i} className={`pp-tile t${i}`} />)}</div>
        <div className="pp-slot">
          <span className="pp-slot-label">Dari mitra Student Hub</span>
          <AdCard ad={ad} preview />
        </div>
        <div className="pp-news"><span className="pp-line w60" /><span className="pp-line w40" /></div>
      </div>
    </div>
    {caption && <figcaption><strong>Tampil di beranda siswa</strong> — satu slot di bawah menu utama, berlabel &ldquo;Sponsor&rdquo;. Tidak pernah muncul saat absen, di rapor, atau di tagihan.</figcaption>}
  </figure>;
}
