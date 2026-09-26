"use client";
import { useState } from "react";
import type { ReviewAdDto } from "@/lib/frontend/ad-types";
import { bannerSrc } from "@/lib/frontend/ad-media";
import { demoReviewAds } from "@/lib/frontend/demo-ads";
import { countLabel, nextAfter, resolveSelection, scheduleInfo, timeAgo } from "@/lib/frontend/review-rules";
import type { Module } from "@/lib/frontend/types";
import { Segmented } from "../charts/segmented";
import { useHub } from "../context";
import { AD_DONE, AD_GONE, adDecisionConfig, adPatch, submitAdDecision } from "./review-ad-config";
import { AdDetail, type AdDecision } from "./review-ad-detail";
import { DecisionDialog } from "./review-decision-dialog";
import { SPLIT_QUERY, useMediaQuery, useQueueSearch, useRemoteDetail, useReviewQueue, type ReviewQueue } from "./review-hooks";
import { QueueList, QueueSearchField, ReviewEmpty, ReviewLayout } from "./review-layout";

/**
 * Moderasi iklan super admin: antrean per status (menunggu tinjauan = terlama diajukan dulu), detail
 * dengan banner & pratinjau beranda siswa, lalu setujui / tolak beralasan / turunkan. Tab selain
 * antrean bisa dicari menurut judul. Mode demo mensimulasikan keputusan secara lokal tanpa permintaan ke server.
 */

type AdTab = "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "PAUSED";
const TAB_LABEL: Record<AdTab, string> = { PENDING_REVIEW: "Menunggu tinjauan", APPROVED: "Disetujui", REJECTED: "Ditolak", PAUSED: "Dijeda" };
const TABS: readonly AdTab[] = ["PENDING_REVIEW", "APPROVED", "REJECTED", "PAUSED"];
const EMPTY: Record<AdTab, { title: string; text: string }> = {
  PENDING_REVIEW: { title: "Antrean bersih", text: "Tidak ada iklan yang menunggu tinjauan. Pengajuan baru dari sponsor akan muncul di sini." },
  APPROVED: { title: "Belum ada iklan disetujui", text: "Iklan yang kamu setujui tampil di sini dan masih bisa diturunkan." },
  REJECTED: { title: "Belum ada iklan ditolak", text: "Iklan yang ditolak atau diturunkan tampil di sini beserta alasannya." },
  PAUSED: { title: "Tidak ada iklan dijeda", text: "Iklan yang sedang dijeda sponsor tampil di sini." },
};
const allDemoAds = () => demoReviewAds("ALL");
const adTitle = (ad: ReviewAdDto) => ad.title;
/** Antrean menunggu tinjauan selalu utuh (terlama dulu); pencarian hanya untuk tab riwayat. */
const searchable = (tab: AdTab) => tab !== "PENDING_REVIEW";

export function AdReviewPage({ module }: { module: Module }) {
  const r = useAdReview();
  const options = TABS.map(value => ({ value, label: value === "PENDING_REVIEW" ? countLabel(TAB_LABEL[value], r.queue.pending) : TAB_LABEL[value] }));
  const header = searchable(r.tab) ? <QueueSearchField label="Cari judul iklan" value={r.search.text} onChange={r.search.change} /> : null;
  const list = <QueueList label="Antrean iklan" summary={queueSummary(r.tab, r.queue, r.query)} queue={r.queue} selectedId={r.selectedId} onSelect={r.pick}
    empty={r.query ? noMatch(r.tab, r.query) : EMPTY[r.tab]} header={header} renderItem={ad => <AdQueueItem ad={ad} tab={r.tab} now={r.now} />} />;
  const { ad, decision } = r;
  const detail = ad && <AdDetail key={ad.id} ad={ad} sync={r.sync} notice={r.notice?.id === ad.id ? r.notice.text : ""} now={r.now} onDecide={r.setDecision} />;
  return <div className="workspace-page review-page">
    <div className="page-heading"><div><h1>{module.title}</h1><p>{module.description}</p></div></div>
    <div className="review-toolbar"><Segmented options={options} value={r.tab} onChange={r.changeTab} ariaLabel="Status iklan" /></div>
    <ReviewLayout wide={r.wide} list={list} detail={detail} detailId={r.selectedId} detailLabel="Detail iklan" onCloseSheet={() => r.pick(null)}
      placeholder={<ReviewEmpty icon="image" title="Pilih iklan" text="Pilih iklan dari antrean untuk melihat banner, tautan tujuan, dan jangkauannya." />} />
    {decision && ad && <DecisionDialog config={adDecisionConfig(decision, ad, r.now)} onSubmit={reason => r.decide(decision, ad, reason)} onClose={() => r.setDecision(null)} />}
  </div>;
}

function useAdReview() {
  const { demo } = useHub();
  const [tab, setTab] = useState<AdTab>("PENDING_REVIEW");
  const [picked, setPicked] = useState<string | null>(null);
  const [detailVersion, setDetailVersion] = useState(0);
  const [now] = useState(() => new Date());
  const search = useQueueSearch();
  const wide = useMediaQuery(SPLIT_QUERY);
  const query = searchable(tab) ? search.query : "";
  const queue = useReviewQueue<ReviewAdDto>({ path: "/platform/ads", status: tab, pendingStatus: "PENDING_REVIEW", query, demoAll: allDemoAds, searchText: adTitle });
  const selectedId = resolveSelection(picked, queue.items.map(i => i.id), wide);
  const row = queue.items.find(i => i.id === selectedId) ?? null;
  const remote = useRemoteDetail<ReviewAdDto>(!demo && row ? `/platform/ads/${encodeURIComponent(row.id)}` : null, detailVersion);
  const retryDetail = () => setDetailVersion(v => v + 1);
  const actions = useAdDecisions({ queue, wide, setPicked, onStale: retryDetail });
  // Pemberitahuan "data berubah" hanya berlaku untuk item yang sedang dibuka saat itu.
  const pick = (id: string | null) => { setPicked(id); actions.clearNotice(); };
  const changeTab = (next: AdTab) => { setTab(next); pick(null); search.clear(); };
  const sync = { ready: demo || remote.data !== null, error: remote.error, onRetry: retryDetail };
  return { tab, changeTab, queue, query, search, wide, now, selectedId, pick, ad: remote.data ?? row, sync, ...actions };
}

interface DecisionDeps { readonly queue: ReviewQueue<ReviewAdDto>; readonly wide: boolean; readonly setPicked: (id: string | null) => void; readonly onStale: () => void }

/** Keputusan atas iklan terpilih: kirim (atau simulasikan di demo), pindahkan dari antrean, pilih berikutnya. */
function useAdDecisions({ queue, wide, setPicked, onStale }: DecisionDeps) {
  const { demo, toast } = useHub();
  const [decision, setDecision] = useState<AdDecision | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  async function decide(kind: AdDecision, ad: ReviewAdDto, reason: string) {
    const conflict = demo ? null : await submitAdDecision(kind, ad, reason);
    setDecision(null);
    if (conflict) {
      // Diajukan ulang: item tetap di antrean, jadi pemberitahuan tampil di detailnya. Status berubah:
      // item keluar dari antrean setelah dimuat ulang, jadi penjelasannya lewat toast.
      if (conflict.code === "AD_REVIEW_STALE") setNotice({ id: ad.id, text: conflict.text });
      else toast(conflict.code === "AD_INVALID_TRANSITION" ? AD_GONE[kind] : conflict.text);
      onStale();
      queue.reload();
      return;
    }
    const next = nextAfter(queue.items.map(i => i.id), ad.id);
    queue.settle(ad.id, adPatch(kind, reason));
    toast(demo ? AD_DONE[kind].demo : AD_DONE[kind].live);
    setPicked(wide ? next : null);
  }
  return { decision, setDecision, notice, clearNotice: () => setNotice(null), decide };
}

function queueSummary(tab: AdTab, queue: ReviewQueue<ReviewAdDto>, query: string): string {
  if (tab === "PENDING_REVIEW") return `${queue.total} iklan menunggu · terlama diajukan lebih dulu`;
  const base = `${queue.total} iklan ${TAB_LABEL[tab].toLowerCase()}`;
  return query ? `${base} dengan judul memuat “${query}”` : base;
}

function noMatch(tab: AdTab, query: string): { title: string; text: string } {
  return { title: "Tidak ada yang cocok", text: `Tidak ada iklan ${TAB_LABEL[tab].toLowerCase()} dengan judul memuat “${query}”. Coba kata kunci lain.` };
}

function AdQueueItem({ ad, tab, now }: { ad: ReviewAdDto; tab: AdTab; now: Date }) {
  const when = tab === "PENDING_REVIEW" && ad.submittedAt ? `Diajukan ${timeAgo(ad.submittedAt, now)}` : scheduleInfo(ad.startAt, ad.endAt, now).range;
  return <>
    <span className="review-thumb">
      {/* eslint-disable-next-line @next/next/no-img-element -- banner privat lewat proxy sesi atau salinan publik /media; next/image tidak melayani keduanya */}
      <img src={bannerSrc(ad)} alt="" loading="lazy" decoding="async" />
    </span>
    <span className="review-item-text"><strong>{ad.title}</strong><span>{ad.sponsor.companyName}</span><small>{when}</small></span>
  </>;
}
