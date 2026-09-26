"use client";
import { useId } from "react";
import type { AdDto, AdPerformanceDto } from "@/lib/frontend/ad-types";
import { bannerSrc } from "@/lib/frontend/ad-media";
import { number } from "@/lib/frontend/format";
import { liveByClicks, statusSummary, wibShortDate } from "@/lib/frontend/sponsor-insights-rules";
import type { AdCardData } from "../ads/ad-card";
import { PlacementPreview } from "../ads/placement-preview";
import { HubLink } from "../hub-link";
import { Icon } from "../icon";
import { AdThumb } from "./insights-table";

/** Kampanye yang sedang tayang (LIVE) dengan klik & tayangan 7 hari, urut klik terbanyak. */
export function LiveCampaigns({ ads, perf }: { ads: readonly AdDto[] | null; perf: readonly AdPerformanceDto[] | null }) {
  const headingId = useId();
  const stats = new Map((perf ?? []).map(p => [p.adId, p]));
  const live = liveByClicks(ads ?? [], perf ?? []);
  const summary = ads ? statusSummary(ads) : "";
  return <section className="panel insight-panel" aria-labelledby={headingId}>
    <div className="insight-heading">
      <div><h2 id={headingId}>Kampanye aktif</h2><p>{ads ? summary || "Belum ada kampanye." : "Memuat kampanye…"}</p></div>
      <HubLink href="/hub/campaigns" className="text-link">Kelola kampanye<Icon name="arrow" size={15} /></HubLink>
    </div>
    {!ads ? <div className="chart-skeleton" aria-hidden="true"><span className="skeleton" /><span className="skeleton" /></div>
      : live.length ? <><ul className="live-list">{live.map(ad => <LiveItem key={ad.id} ad={ad} stat={stats.get(ad.id)} />)}</ul><p className="insight-footnote">Klik & tayangan 7 hari terakhir.</p></>
        : <div className="live-empty"><p>Belum ada kampanye yang sedang tayang.</p><HubLink href="/hub/campaigns?baru=1" className="button secondary small-button"><Icon name="plus" size={16} />Buat kampanye</HubLink></div>}
  </section>;
}

function LiveItem({ ad, stat }: { ad: AdDto; stat: AdPerformanceDto | undefined }) {
  return <li><HubLink href="/hub/campaigns" className="live-item">
    <AdThumb src={bannerSrc(ad)} />
    <span className="live-body">
      <strong>{ad.title}</strong>
      <span className="live-stats">
        <span><b>{number(stat?.clicks ?? 0)}</b> klik</span>
        <span><b>{number(stat?.impressions ?? 0)}</b> tayangan</span>
        <span>hingga {wibShortDate(ad.endAt)}</span>
      </span>
    </span>
    <Icon name="chevron" size={14} />
  </HubLink></li>;
}

/** Banner contoh 1200x600 (tanpa aset luar) untuk pratinjau sebelum ada iklan tayang. */
const EXAMPLE_BANNER = `data:image/svg+xml;utf8,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 600'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#e4eafa'/><stop offset='1' stop-color='#c9d6f4'/></linearGradient></defs><rect width='1200' height='600' fill='url(#g)'/><text x='600' y='322' font-family='Arial, sans-serif' font-size='68' font-weight='700' fill='#1c4acd' text-anchor='middle'>Banner 1200 × 600</text></svg>")}`;

const POINTS: readonly (readonly [string, string])[] = [
  ["grid", "Satu slot di beranda siswa, tepat di bawah menu utama, dengan label kecil “Sponsor”."],
  ["image", "Banner 2:1 (1200 × 600 piksel), judul singkat, dan nama perusahaan Anda."],
  ["refresh", "Bergiliran: maksimal 5 iklan per jam, dan paling banyak 2 iklan dari satu sponsor untuk tiap siswa."],
  ["wallet", "Anda hanya membayar klik yang sah, dipotong dari saldo sesuai biaya per klik. Tiap siswa ditagih paling banyak sekali per iklan per hari; tayangan tidak dikenai biaya."],
  ["shield", "Tidak pernah tampil di halaman absensi, rapor, maupun tagihan."],
];

/** "Di mana iklan Anda tampil?": tiruan layar beranda siswa + penjelasan singkat aturan tayang. */
export function PlacementPanel({ ad, companyName }: { ad: AdDto | null; companyName: string }) {
  const headingId = useId();
  const card: AdCardData = ad ? { title: ad.title, imageSrc: bannerSrc(ad), sponsorName: companyName } : { title: "Judul kampanye Anda tampil di sini", imageSrc: EXAMPLE_BANNER, sponsorName: companyName };
  return <section className="panel insight-panel placement-panel" aria-labelledby={headingId}>
    <div className="insight-heading"><div><h2 id={headingId}>Di mana iklan Anda tampil?</h2><p>{ad ? "Kampanye teratas Anda, persis seperti yang dilihat siswa." : "Contoh tampilan kartu iklan di aplikasi siswa."}</p></div></div>
    <div className="placement-body">
      <PlacementPreview ad={card} caption={false} />
      <div className="placement-copy">
        <ul className="placement-points">{POINTS.map(([icon, text]) => <li key={icon}><span className="point-icon"><Icon name={icon} size={18} /></span><span>{text}</span></li>)}</ul>
        <div className="placement-tips">
          <h3>Agar banner mudah dibaca di HP</h3>
          <ul>{TIPS.map(tip => <li key={tip}>{tip}</li>)}</ul>
        </div>
      </div>
    </div>
  </section>;
}

const TIPS: readonly string[] = [
  "Satu pesan utama dengan teks besar — di HP banner tampil sekitar 330 piksel lebarnya.",
  "Jauhkan teks penting dari pojok kanan atas; di sana ada label “Sponsor”.",
  "Arahkan tautan ke halaman yang isinya sesuai dengan banner.",
];
