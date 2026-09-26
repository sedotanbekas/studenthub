"use client";
import { useState } from "react";
import type { LedgerEntryDto, PlatformTopUpDto } from "@/lib/frontend/ad-types";
import { fileSrc } from "@/lib/frontend/ad-media";
import { api, ApiError } from "@/lib/frontend/api";
import { demoPlatformTopUps } from "@/lib/frontend/demo-ads";
import { rupiah } from "@/lib/frontend/format";
import { calendarDate, countLabel, loadedSum, nextAfter, resolveSelection, reviewFailure, timeAgo } from "@/lib/frontend/review-rules";
import type { Module } from "@/lib/frontend/types";
import { Segmented } from "../charts/segmented";
import { useHub } from "../context";
import { DecisionDialog, type DecisionConfig } from "./review-decision-dialog";
import { errorText, SPLIT_QUERY, useMediaQuery, useReviewQueue, type ReviewQueue } from "./review-hooks";
import { QueueList, ReviewEmpty, ReviewLayout } from "./review-layout";
import { TopUpDetail } from "./review-topup-detail";

/**
 * Verifikasi top-up super admin: antrean per status (menunggu = terlama dulu), bukti transfer besar,
 * saldo sponsor sebelum → sesudah, setujui (wajib centang nominal sesuai) atau tolak beralasan.
 * Mode demo mensimulasikan keputusan secara lokal tanpa permintaan ke server.
 */

type TopUpTab = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
const TAB_LABEL: Record<TopUpTab, string> = { PENDING: "Menunggu", APPROVED: "Disetujui", REJECTED: "Ditolak", CANCELLED: "Dibatalkan" };
const TABS: readonly TopUpTab[] = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"];
const EMPTY: Record<TopUpTab, { title: string; text: string }> = {
  PENDING: { title: "Semua top-up sudah diverifikasi", text: "Pengajuan top-up baru dari sponsor akan muncul di sini." },
  APPROVED: { title: "Belum ada top-up disetujui", text: "Top-up yang disetujui dan sudah masuk ke saldo sponsor tampil di sini." },
  REJECTED: { title: "Belum ada top-up ditolak", text: "Top-up yang ditolak tampil di sini beserta alasannya." },
  CANCELLED: { title: "Tidak ada top-up dibatalkan", text: "Top-up yang dibatalkan sponsor sebelum diverifikasi tampil di sini." },
};
const allDemoTopUps = () => demoPlatformTopUps("ALL");

export function TopUpReviewPage({ module }: { module: Module }) {
  const r = useTopUpReview();
  const { topUp } = r;
  const options = TABS.map(value => ({ value, label: value === "PENDING" ? countLabel(TAB_LABEL[value], r.queue.pending) : TAB_LABEL[value] }));
  const list = <QueueList label="Antrean top-up" summary={queueSummary(r.tab, r.queue)} queue={r.queue} selectedId={r.selectedId} onSelect={r.setPicked}
    empty={EMPTY[r.tab]} renderItem={t => <TopUpQueueItem topUp={t} now={r.now} />} />;
  const detail = topUp && <TopUpDetail key={topUp.id} topUp={topUp} now={r.now} busy={r.busy} error={r.error?.id === topUp.id ? r.error.text : ""} onApprove={() => void r.approve(topUp)} onReject={() => r.setRejecting(true)} />;
  return <div className="workspace-page review-page">
    <div className="page-heading"><div><h1>{module.title}</h1><p>{module.description}</p></div></div>
    <div className="review-toolbar"><Segmented options={options} value={r.tab} onChange={r.changeTab} ariaLabel="Status top-up" /></div>
    <ReviewLayout wide={r.wide} list={list} detail={detail} detailId={r.selectedId} detailLabel="Detail top-up" onCloseSheet={() => r.setPicked(null)}
      placeholder={<ReviewEmpty icon="wallet" title="Pilih pengajuan" text="Pilih top-up dari antrean untuk mencocokkan bukti transfer dengan nominalnya." />} />
    {r.rejecting && topUp && <DecisionDialog config={rejectConfig(topUp)} onSubmit={reason => r.reject(topUp, reason)} onClose={() => r.setRejecting(false)} />}
  </div>;
}

function useTopUpReview() {
  const [tab, setTab] = useState<TopUpTab>("PENDING");
  const [picked, setPicked] = useState<string | null>(null);
  const [now] = useState(() => new Date());
  const wide = useMediaQuery(SPLIT_QUERY);
  // API top-up belum mendukung pencarian (`q`), jadi tab riwayat top-up hanya berpaginasi.
  const queue = useReviewQueue<PlatformTopUpDto>({ path: "/platform/topups", status: tab, pendingStatus: "PENDING", query: "", demoAll: allDemoTopUps });
  const selectedId = resolveSelection(picked, queue.items.map(i => i.id), wide);
  const topUp = queue.items.find(i => i.id === selectedId) ?? null;
  const actions = useTopUpDecisions(queue, wide, setPicked);
  const changeTab = (next: TopUpTab) => { setTab(next); setPicked(null); };
  return { tab, changeTab, queue, wide, now, selectedId, setPicked, topUp, ...actions };
}

/** Setujui/tolak: kirim (atau simulasikan di demo), keluarkan dari antrean, pilih pengajuan berikutnya. */
function useTopUpDecisions(queue: ReviewQueue<PlatformTopUpDto>, wide: boolean, setPicked: (id: string | null) => void) {
  const { demo, toast } = useHub();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const finish = (topUp: PlatformTopUpDto, patch: Partial<PlatformTopUpDto>, message: string) => {
    const next = nextAfter(queue.items.map(i => i.id), topUp.id);
    queue.settle(topUp.id, { ...patch, reviewedAt: new Date().toISOString() });
    toast(message);
    setPicked(wide ? next : null);
  };
  async function approve(topUp: PlatformTopUpDto) {
    setBusy(true);
    setError(null);
    try {
      const balance = demo ? topUp.sponsor.balance + topUp.amount : await submitApproval(topUp);
      const prefix = demo ? "Mode demo: top-up disetujui" : "Top-up disetujui";
      finish(topUp, { status: "APPROVED", reviewNote: null, sponsor: { ...topUp.sponsor, balance } }, `${prefix}. Saldo ${topUp.sponsor.companyName} kini ${rupiah(balance)}.`);
    } catch (e) {
      const failure = e instanceof ApiError ? reviewFailure(e.code) : null;
      const text = [errorText(e, "Top-up belum dapat disetujui."), failure?.hint].filter(Boolean).join(" ");
      if (failure?.reload) { toast(text); queue.reload(); } else setError({ id: topUp.id, text });
    } finally {
      setBusy(false);
    }
  }
  async function reject(topUp: PlatformTopUpDto, reason: string) {
    if (!demo && !(await submitRejection(topUp, reason, toast))) { queue.reload(); setRejecting(false); return; }
    setRejecting(false);
    finish(topUp, { status: "REJECTED", reviewNote: reason }, demo ? "Mode demo: top-up ditolak; di akun asli sponsor menerima alasanmu." : "Top-up ditolak. Sponsor menerima alasanmu lewat notifikasi.");
  }
  return { busy, error, rejecting, setRejecting, approve, reject };
}

/** POST approve tanpa body → saldo sponsor setelah dikreditkan (dari entri ledger). */
async function submitApproval(topUp: PlatformTopUpDto): Promise<number> {
  const result = await api(`/platform/topups/${encodeURIComponent(topUp.id)}/approve`, { method: "POST" });
  const { ledgerEntry } = result.data as { topUp: PlatformTopUpDto; ledgerEntry: LedgerEntryDto };
  return ledgerEntry.balanceAfter;
}

/** true = ditolak; false = sudah ditinjau pihak lain (toast + muat ulang). Galat lain dilempar ke dialog. */
async function submitRejection(topUp: PlatformTopUpDto, reason: string, toast: (text: string) => void): Promise<boolean> {
  try {
    await api(`/platform/topups/${encodeURIComponent(topUp.id)}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
    return true;
  } catch (e) {
    if (!(e instanceof ApiError) || !reviewFailure(e.code).reload) throw e;
    toast([e.message, reviewFailure(e.code).hint].filter(Boolean).join(" "));
    return false;
  }
}

function rejectConfig(topUp: PlatformTopUpDto): DecisionConfig {
  return {
    eyebrow: "Verifikasi top-up", title: "Tolak top-up", confirmLabel: "Tolak top-up", tone: "danger",
    intro: <p>Top-up <strong>{rupiah(topUp.amount)}</strong> dari {topUp.sponsor.companyName} tidak dikreditkan. Sponsor menerima alasan ini dan dapat mengajukan ulang dengan bukti yang benar.</p>,
    reason: {
      label: "Alasan untuk sponsor", chips: ["Nominal tidak sesuai", "Bukti tidak terbaca", "Transfer belum masuk ke rekening"],
      hint: "5–255 karakter. Sebutkan apa yang perlu diperbaiki.", placeholder: "Contoh: Nominal pada bukti Rp100.000, sedangkan pengajuan Rp1.000.000.",
    },
  };
}

/** Jumlah nominal hanya utuh bila semua baris termuat; selain itu diberi label "(dari N yang ditampilkan)". */
function queueSummary(tab: TopUpTab, queue: ReviewQueue<PlatformTopUpDto>): string {
  const sum = loadedSum(rupiah(queue.items.reduce((total, t) => total + t.amount, 0)), queue.items.length, queue.total);
  return tab === "PENDING" ? `${queue.total} pengajuan menunggu · ${sum} · terlama dulu` : `${queue.total} top-up ${TAB_LABEL[tab].toLowerCase()} · ${sum}`;
}

function TopUpQueueItem({ topUp, now }: { topUp: PlatformTopUpDto; now: Date }) {
  return <>
    <span className="review-thumb proof">
      {/* eslint-disable-next-line @next/next/no-img-element -- bukti transfer privat lewat proxy sesi /api/web/files; next/image tidak dapat meneruskan sesi */}
      <img src={fileSrc(topUp.proofFileId)} alt="" loading="lazy" decoding="async" />
    </span>
    <span className="review-item-text">
      <strong className="review-item-amount">{rupiah(topUp.amount)}</strong>
      <span>{topUp.sponsor.companyName}</span>
      <small>{topUp.senderBank} · transfer {calendarDate(topUp.transferDate, "short")} · {timeAgo(topUp.createdAt, now)}</small>
      {topUp.duplicateProofOf.length > 0 && <span className="review-flag">Bukti ganda</span>}
    </span>
  </>;
}
