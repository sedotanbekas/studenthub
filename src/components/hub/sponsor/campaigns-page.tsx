"use client";
import { useCallback, useEffect, useState } from "react";
import type { AdDto } from "@/lib/frontend/ad-types";
import { bannerSrc } from "@/lib/frontend/ad-media";
import { CAMPAIGN_FILTERS, filterCounts, matchesFilter, type CampaignFilter } from "@/lib/frontend/campaign-rules";
import { wibToday } from "@/lib/frontend/demo-ads";
import type { Module } from "@/lib/frontend/types";
import { useHub } from "../context";
import { Icon } from "../icon";
import { afterPageSlide } from "../page-slide";
import { CampaignCard } from "./campaign-card";
import { useCampaignData, type CampaignData } from "./campaign-data";
import { CampaignDetail } from "./campaign-detail";
import { CampaignEditor } from "./campaign-editor";

/**
 * "Kampanye saya" (sponsor): daftar kampanye berfilter, detail dengan pratinjau penempatan & aksi yang
 * sah, serta editor dengan pratinjau langsung. `?baru=1` membuka editor saat halaman dibuka.
 */
type Editing = { readonly ad: AdDto | null } | null;

/** Banner lokal (object URL) dari mode demo, selain itu salinan publik/pratinjau privat. */
export type BannerResolver = (ad: Pick<AdDto, "imageUrl" | "imageFileId">) => string;

function useOpenFromQuery(enabled: boolean, open: () => void) {
  useEffect(() => {
    if (!enabled || new URLSearchParams(window.location.search).get("baru") !== "1") return;
    window.history.replaceState(null, "", window.location.pathname);
    // Editor dibuka setelah halaman selesai bergeser masuk agar dialog tidak ikut tercampur transisi.
    return afterPageSlide(open);
  }, [enabled, open]);
}

export function CampaignsPage({ module }: { module: Module }) {
  const { me } = useHub();
  const { state, reload, updateAds, loadMore } = useCampaignData();
  const [editing, setEditing] = useState<Editing>(null);
  const [localBanners, setLocalBanners] = useState<Readonly<Record<string, string>>>({});
  const data = state.kind === "ready" ? state.data : null;
  const readOnly = data?.sponsorStatus === "SUSPENDED";
  const openCreate = useCallback(() => setEditing({ ad: null }), []);
  useOpenFromQuery(data !== null && !readOnly, openCreate);
  const srcOf: BannerResolver = ad => localBanners[ad.imageFileId] ?? bannerSrc(ad);
  const upsert = (ad: AdDto) => updateAds(ads => (ads.some(a => a.id === ad.id) ? ads.map(a => (a.id === ad.id ? ad : a)) : [ad, ...ads]));
  return <div className="workspace-page campaigns-page">
    <div className="page-heading"><div><h1>{module.title}</h1><p>{module.description}</p></div>
      <div className="heading-actions"><button type="button" className="button primary" disabled={!data || readOnly} onClick={openCreate}><Icon name="plus" size={20} />Buat kampanye</button></div>
    </div>
    {data?.sponsorStatus === "PENDING" && <p className="info-message" role="note">Akun sponsor Anda masih diverifikasi admin. Anda sudah bisa menyiapkan draf kampanye; pengajuan tinjauan dibuka setelah akun disetujui.</p>}
    {readOnly && <p className="warning-message" role="note">Akun sponsor sedang ditangguhkan. Kampanye tidak tayang dan hanya bisa dilihat.</p>}
    {state.kind === "loading" ? <ListSkeleton />
      : state.kind === "error" ? <div className="error-message" role="alert">{state.message}<button type="button" className="text-button" onClick={reload}>Coba lagi</button></div>
      : <CampaignBoard data={state.data} srcOf={srcOf} onEdit={ad => setEditing({ ad })} onUpsert={upsert} onRemove={id => updateAds(ads => ads.filter(a => a.id !== id))} onCreate={openCreate} readOnly={readOnly} />}
    {loadMore.available && <div className="campaign-more">
      {loadMore.error && <p className="error-message" role="alert">{loadMore.error}</p>}
      <button type="button" className="button secondary" disabled={loadMore.busy} onClick={() => void loadMore.load()}>{loadMore.busy ? "Memuat…" : "Muat lebih banyak"}</button>
    </div>}
    {editing && data && <CampaignEditor ad={editing.ad} data={data} sponsorName={me.sponsor?.companyName ?? me.user.name} srcOf={srcOf}
      onLocalBanner={(fileId, url) => setLocalBanners(prev => ({ ...prev, [fileId]: url }))}
      onUpsert={upsert} onClose={() => setEditing(null)} />}
  </div>;
}

function ListSkeleton() {
  return <div className="campaign-grid" aria-busy="true" aria-label="Memuat kampanye">
    {[0, 1, 2].map(i => <div key={i} className="campaign-skeleton"><div className="skeleton thumb" /><div className="skeleton" /><div className="skeleton short" /></div>)}
  </div>;
}

interface BoardProps {
  readonly data: CampaignData;
  readonly srcOf: BannerResolver;
  readonly readOnly: boolean;
  readonly onEdit: (ad: AdDto) => void;
  readonly onUpsert: (ad: AdDto) => void;
  readonly onRemove: (id: string) => void;
  readonly onCreate: () => void;
}

function CampaignBoard({ data, srcOf, readOnly, onEdit, onUpsert, onRemove, onCreate }: BoardProps) {
  const { me } = useHub();
  const [filter, setFilter] = useState<CampaignFilter>("ALL");
  const [openId, setOpenId] = useState<string | null>(null);
  const today = wibToday();
  const sponsorName = me.sponsor?.companyName ?? me.user.name;
  const shown = data.ads.filter(ad => matchesFilter(ad, filter));
  const open = openId ? data.ads.find(ad => ad.id === openId) ?? null : null;
  if (data.ads.length === 0) return <EmptyCampaigns readOnly={readOnly} onCreate={onCreate} />;
  return <>
    <FilterChips value={filter} counts={filterCounts(data.ads)} onChange={setFilter} />
    {shown.length === 0
      ? <div className="empty-state compact"><Icon name="search" size={30} /><h2>Tidak ada kampanye di sini</h2><p>Belum ada kampanye dengan status ini.</p><button type="button" className="text-button" onClick={() => setFilter("ALL")}>Tampilkan semua</button></div>
      : <ul className="campaign-grid" aria-label="Daftar kampanye">{shown.map(ad => <CampaignCard key={ad.id} ad={ad} src={srcOf(ad)} sponsorName={sponsorName} performance={data.performance[ad.id]} today={today} onOpen={() => setOpenId(ad.id)} />)}</ul>}
    {open && <CampaignDetail ad={open} src={srcOf(open)} sponsorName={sponsorName} sponsorStatus={data.sponsorStatus}
      onClose={() => setOpenId(null)} onEdit={() => { setOpenId(null); onEdit(open); }} onChanged={onUpsert} onRemoved={() => { setOpenId(null); onRemove(open.id); }} />}
  </>;
}

function FilterChips({ value, counts, onChange }: { value: CampaignFilter; counts: Record<CampaignFilter, number>; onChange: (f: CampaignFilter) => void }) {
  return <div className="campaign-chips" role="group" aria-label="Saring kampanye menurut status">
    {CAMPAIGN_FILTERS.map(f => <button key={f.value} type="button" className="camp-chip" aria-pressed={value === f.value} onClick={() => onChange(f.value)}>
      {f.label}<b>{counts[f.value]}</b>
    </button>)}
  </div>;
}

function EmptyCampaigns({ readOnly, onCreate }: { readOnly: boolean; onCreate: () => void }) {
  return <div className="panel campaign-empty">
    <span className="empty-icon" aria-hidden="true"><Icon name="megaphone" size={30} /></span>
    <h2>Belum ada kampanye</h2>
    <p>Kampanye tampil sebagai satu kartu kecil berlabel &ldquo;Sponsor&rdquo; di beranda siswa: tenang, tidak mengganggu, dan dibayar hanya saat diklik.</p>
    {!readOnly && <button type="button" className="button primary" onClick={onCreate}><Icon name="plus" size={20} />Buat kampanye pertama</button>}
  </div>;
}
