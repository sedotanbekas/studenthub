"use client";
import { useRef, useState } from "react";
import { sameOriginMedia } from "@/lib/frontend/ad-media";
import type { ServedAd } from "@/lib/frontend/ad-types";
import { useHub } from "../context";
import { Icon } from "../icon";
import { AdCard } from "./ad-card";
import { useCarousel, useImpressions, useOpenAd, useSeenOnScreen, useServedAds } from "./use-sponsor-slot";

/**
 * Satu slot iklan di beranda siswa, di bawah menu utama (tidak pernah di alur absen, rapor, atau
 * tagihan). Tenang tapi terlihat: kartu native berlabel "Sponsor", geser untuk mitra lain, dan
 * penjelasan singkat "Kenapa ada ini?". Slot hilang sepenuhnya bila tidak ada iklan.
 */
export function SponsorSlot() {
  const { demo, toast } = useHub();
  const { ads, reload } = useServedAds(demo);
  const { seen, flush } = useImpressions(demo);
  const { open, busy } = useOpenAd({ demo, seen, flush, reload, toast });
  const { track, index, goTo, onScroll, stop } = useCarousel(ads?.length ?? 0);
  const [about, setAbout] = useState(false);
  if (!ads?.length) return null;
  const many = ads.length > 1;
  return <section className="partner-slot" aria-labelledby="partner-title">
    <div className="partner-head">
      <h2 id="partner-title">Dari mitra Student Hub</h2>
      <button type="button" className="partner-info" aria-expanded={about} aria-controls="partner-about" onClick={() => setAbout(v => !v)}><Icon name="help" size={16} />Kenapa ada ini?</button>
    </div>
    {about && <p id="partner-about" className="partner-about">Mitra pendidikan membantu Student Hub tetap bisa dipakai sekolah. Info dipilih berdasarkan wilayah sekolahmu, bukan dari data pribadimu, dan setiap iklan ditinjau tim Student Hub sebelum tayang.</p>}
    <div className={`ad-track${many ? " many" : ""}`} ref={track} onScroll={onScroll} onPointerDown={stop} onWheel={stop} onFocus={stop} role="region" aria-roledescription="carousel" aria-label="Info dari mitra">
      {ads.map((ad, i) => <AdSlide key={ad.token} ad={ad} label={`${i + 1} dari ${ads.length}`} onSeen={seen} busy={busy === ad.adId} onOpen={() => open(ad)} />)}
    </div>
    {many && <div className="ad-dots">{ads.map((ad, i) => <button key={ad.token} type="button" aria-label={`Tampilkan info mitra ${i + 1}`} aria-current={index === i} className={index === i ? "on" : undefined} onClick={() => { stop(); goTo(i); }} />)}</div>}
  </section>;
}

function AdSlide({ ad, label, onSeen, busy, onOpen }: { ad: ServedAd; label: string; onSeen: (token: string) => void; busy: boolean; onOpen: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useSeenOnScreen(ref, ad.token, onSeen);
  return <div ref={ref} className="ad-slide" role="group" aria-roledescription="slide" aria-label={label}>
    <AdCard ad={{ title: ad.title, imageSrc: sameOriginMedia(ad.imageUrl), sponsorName: ad.sponsorName }} busy={busy} onOpen={onOpen} />
  </div>;
}
