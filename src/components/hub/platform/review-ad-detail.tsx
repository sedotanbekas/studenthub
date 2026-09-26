"use client";
import { useState } from "react";
import type { ReviewAdDto } from "@/lib/frontend/ad-types";
import { bannerSrc, linkHost } from "@/lib/frontend/ad-media";
import { label, rupiah } from "@/lib/frontend/format";
import { approveBlocker, safeHref, scheduleInfo, timeAgo, wibDateTime } from "@/lib/frontend/review-rules";
import { PlacementPreview } from "../ads/placement-preview";
import { Status } from "../data-view";
import { Icon } from "../icon";
import { Fact } from "./review-layout";

/**
 * Detail iklan untuk peninjau: banner besar, pratinjau di beranda siswa, fakta (sponsor, tautan
 * tujuan dengan host menonjol, jangkauan, jadwal, CPC), panduan peninjauan, dan tombol keputusan.
 */

export type AdDecision = "approve" | "reject" | "takedown";

/** Keadaan pemuatan detail terbaru (token CAS) yang menentukan tombol keputusan boleh dipakai. */
export interface DetailSync {
  /** false = detail terbaru belum dimuat (token CAS belum pasti) → tombol keputusan menunggu. */
  readonly ready: boolean;
  /** Galat memuat detail terbaru; "" = tidak ada. */
  readonly error: string;
  readonly onRetry: () => void;
}

interface AdDetailProps {
  readonly ad: ReviewAdDto;
  readonly sync: DetailSync;
  readonly notice: string;
  readonly now: Date;
  readonly onDecide: (kind: AdDecision) => void;
}

export function AdDetail({ ad, sync, notice, now, onDecide }: AdDetailProps) {
  const src = bannerSrc(ad);
  return <article className="review-detail" aria-labelledby="review-ad-title">
    <header className="review-detail-head">
      <div className="review-detail-meta"><Status value={ad.status} />{ad.submittedAt && <span>Diajukan {timeAgo(ad.submittedAt, now)}</span>}</div>
      <h2 id="review-ad-title">{ad.title}</h2>
    </header>
    <div className="review-detail-body">
      {notice && <div className="warning-message" role="status"><Icon name="refresh" size={18} />{notice}</div>}
      <figure className="review-banner">
        {/* eslint-disable-next-line @next/next/no-img-element -- banner privat lewat proxy sesi /api/web/files atau salinan publik /media; next/image tidak melayani keduanya */}
        <img src={src} alt={`Banner iklan: ${ad.title}`} decoding="async" />
        <figcaption>{ad.imageUrl ? "Banner yang sedang dipakai (salinan publik)" : "Pratinjau privat — belum terlihat siswa sampai disetujui"}</figcaption>
      </figure>
      <div className="review-detail-grid">
        <AdFacts ad={ad} now={now} />
        <PlacementPreview ad={{ title: ad.title, imageSrc: src, sponsorName: ad.sponsor.companyName }} />
      </div>
      {ad.status === "PENDING_REVIEW" && <ReviewChecklist key={ad.id} />}
      {ad.reviewNote && <div className="review-note"><span className="eyebrow">Catatan peninjau</span><p>{ad.reviewNote}</p>{ad.reviewedAt && <small>{wibDateTime(ad.reviewedAt)}</small>}</div>}
    </div>
    <AdActions ad={ad} sync={sync} now={now} onDecide={onDecide} />
  </article>;
}

function AdFacts({ ad, now }: { ad: ReviewAdDto; now: Date }) {
  const schedule = scheduleInfo(ad.startAt, ad.endAt, now);
  const reach = ad.targetScope === "ALL" || ad.targets.length === 0 ? ["Semua sekolah"] : ad.targets.map(t => t.label);
  const lowBalance = ad.sponsor.balance < ad.cpcAmount;
  return <dl className="review-facts">
    <Fact label="Sponsor" wide>
      <span className="review-sponsor"><strong>{ad.sponsor.companyName}</strong><Status value={ad.sponsor.status} /></span>
      <small className={lowBalance ? "review-bad" : undefined}>Saldo {rupiah(ad.sponsor.balance)}{lowBalance ? " — belum cukup untuk satu klik; iklan tidak tayang sampai sponsor top-up" : ""}</small>
    </Fact>
    <Fact label="Tautan tujuan" wide><TargetLink ad={ad} /></Fact>
    <Fact label="Jenis tautan">{label(ad.linkType)}</Fact>
    <Fact label="Biaya per klik">{rupiah(ad.cpcAmount)}<small>dipotong dari saldo sponsor per klik sah</small></Fact>
    <Fact label="Jangkauan" wide>
      <span className="review-tags">{reach.map(r => <span className="pill" key={r}>{r}</span>)}</span>
      {ad.targetScope !== "ALL" && <small>Per {label(ad.targetScope).toLowerCase()}</small>}
    </Fact>
    <Fact label="Jadwal tayang" wide>{schedule.range} · {schedule.days} hari<small className={schedule.state === "ended" ? "review-bad" : undefined}>{schedule.note}</small></Fact>
    {ad.submittedAt && <Fact label="Diajukan" wide>{wibDateTime(ad.submittedAt)}</Fact>}
  </dl>;
}

function TargetLink({ ad }: { ad: ReviewAdDto }) {
  const href = safeHref(ad.targetUrl);
  return <>
    <span className="review-host">{ad.urlHost ?? linkHost(ad.targetUrl)}</span>
    <span className="review-url">{ad.targetUrl}</span>
    {ad.isPunycodeHost && <span className="warning-message review-inline-warn" role="note"><Icon name="shield" size={18} />Domain memakai karakter internasional (xn--). Pastikan bukan tiruan domain terkenal sebelum menyetujui.</span>}
    {href
      ? <a className="text-link" href={href} target="_blank" rel="noopener noreferrer">Buka tautan di tab baru<Icon name="arrow" size={15} /></a>
      : <small>Tautan aplikasi — tidak dibuka dari browser.</small>}
  </>;
}

const CHECKS: readonly (readonly [string, string])[] = [
  ["Sesuai untuk pelajar", "Tanpa rokok, judi, pinjaman online, konten dewasa, atau kekerasan."],
  ["Tidak menyesatkan", "Klaim wajar dan bisa dibuktikan; tanpa janji berlebihan."],
  ["Tautan sesuai isi", "Halaman tujuan membahas hal yang sama dengan banner."],
  ["Tidak meminta data pribadi siswa", "Tanpa formulir NISN, nomor HP, alamat, atau foto."],
];

/** Panduan peninjau (tidak wajib, tidak dikirim ke server). */
function ReviewChecklist() {
  const [done, setDone] = useState<readonly string[]>([]);
  const toggle = (title: string, on: boolean) => setDone(list => (on ? [...list, title] : list.filter(t => t !== title)));
  return <fieldset className="review-checklist">
    <legend>Panduan peninjauan</legend>
    <p>Tidak wajib — membantu memastikan iklan tetap tenang dan aman untuk siswa. <strong>{done.length}/{CHECKS.length} diperiksa</strong></p>
    {CHECKS.map(([title, hint]) => <label className="check-field" key={title}>
      <input type="checkbox" checked={done.includes(title)} onChange={e => toggle(title, e.target.checked)} />
      <span>{title}<small>{hint}</small></span>
    </label>)}
  </fieldset>;
}

/** Penjelasan saat tombol keputusan terkunci: galat memuat (dengan Coba lagi) atau sedang memuat. */
function SyncState({ sync }: { sync: DetailSync }) {
  if (sync.error) {
    return <div className="error-message review-sync" role="alert">
      <span><strong>Data terbaru iklan belum dapat dimuat.</strong> {sync.error} Tombol keputusan aktif setelah data terbaru termuat.</span>
      <button type="button" className="text-button" onClick={sync.onRetry}>Coba lagi</button>
    </div>;
  }
  if (sync.ready) return null;
  return <p className="review-blocker review-sync" role="status"><span className="review-spinner" aria-hidden="true" />Memuat data terbaru…</p>;
}

function AdActions({ ad, sync, now, onDecide }: { ad: ReviewAdDto; sync: DetailSync; now: Date; onDecide: (kind: AdDecision) => void }) {
  const locked = !sync.ready;
  if (ad.status === "PENDING_REVIEW") {
    const blocker = approveBlocker({ sponsorStatus: ad.sponsor.status, endAt: ad.endAt, submittedAt: ad.submittedAt }, now);
    return <footer className="review-actions">
      <SyncState sync={sync} />
      {blocker && <p className="review-blocker"><Icon name="help" size={17} />{blocker}</p>}
      <div className="review-buttons">
        <button type="button" className="button danger-outline" disabled={locked} onClick={() => onDecide("reject")}>Tolak</button>
        <button type="button" className="button primary" disabled={locked || Boolean(blocker)} onClick={() => onDecide("approve")}>Setujui</button>
      </div>
    </footer>;
  }
  if (ad.status !== "APPROVED" && ad.status !== "PAUSED") return sync.error ? <footer className="review-actions"><SyncState sync={sync} /></footer> : null;
  return <footer className="review-actions">
    <SyncState sync={sync} />
    <p className="review-blocker">Menurunkan iklan menghentikan tayangnya untuk semua siswa seketika. Sponsor menerima alasanmu.</p>
    <div className="review-buttons"><button type="button" className="button danger-outline" disabled={locked} onClick={() => onDecide("takedown")}>Turunkan iklan</button></div>
  </footer>;
}
