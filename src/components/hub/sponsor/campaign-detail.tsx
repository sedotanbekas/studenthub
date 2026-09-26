"use client";
import { useState, type ReactNode } from "react";
import { safeHref } from "@/lib/frontend/review-rules";
import type { AdDto } from "@/lib/frontend/ad-types";
import { linkHost } from "@/lib/frontend/ad-media";
import { ACTION_DONE, campaignActions, demoNotice, daysInclusive, lastDayOf, scheduleRange, statusNote, targetSummary, wibTime, longDate, type CampaignAction, type TransitionKey } from "@/lib/frontend/campaign-rules";
import { wibToday } from "@/lib/frontend/demo-ads";
import { label, rupiah } from "@/lib/frontend/format";
import { wibDate } from "@/lib/time/zone";
import { PlacementPreview } from "../ads/placement-preview";
import { useHub } from "../context";
import { Icon } from "../icon";
import { CampaignStatus } from "./campaign-card";
import { deleteCampaign, explainFailure, runTransition, useModal, type SponsorStatus } from "./campaign-data";
import { CampaignWeek } from "./campaign-stats";

/** Detail kampanye (dialog): pratinjau penempatan, info lengkap, ringkasan 7 hari, dan aksi yang sah. */
interface DetailProps {
  readonly ad: AdDto;
  readonly src: string;
  readonly sponsorName: string;
  readonly sponsorStatus: SponsorStatus | null;
  readonly onClose: () => void;
  readonly onEdit: () => void;
  readonly onChanged: (ad: AdDto) => void;
  readonly onRemoved: () => void;
}

function useCampaignActions({ ad, onChanged, onRemoved, onEdit }: Pick<DetailProps, "ad" | "onChanged" | "onRemoved" | "onEdit">) {
  const { demo, toast } = useHub();
  const [busy, setBusy] = useState<CampaignAction["key"] | null>(null);
  const [error, setError] = useState("");
  async function run(action: CampaignAction) {
    if (action.key === "edit") { onEdit(); return; }
    setBusy(action.key); setError("");
    try {
      if (action.key === "delete") { await deleteCampaign(ad, demo); onRemoved(); }
      else onChanged(await runTransition(ad, action.key as TransitionKey, demo));
      toast(demo ? demoNotice(ACTION_DONE[action.key]) : ACTION_DONE[action.key]);
    } catch (e) {
      // Status basi (diubah di tab lain): versi terbaru dimuat ke daftar sehingga aksi yang sah ikut diperbarui.
      const { failure, latest } = await explainFailure(e, ad.id, demo);
      if (latest) onChanged(latest);
      setError(failure.message);
    } finally { setBusy(null); }
  }
  return { busy, error, run };
}

export function CampaignDetail(props: DetailProps) {
  const { ad, src, sponsorName, sponsorStatus, onClose } = props;
  const { busy, error, run } = useCampaignActions(props);
  const [confirm, setConfirm] = useState<CampaignAction | null>(null);
  const { ref, onCancel } = useModal(onClose, busy !== null);
  const actions = campaignActions(ad, sponsorStatus);
  const main = actions.filter(a => a.kind !== "danger");
  const danger = actions.filter(a => a.kind === "danger");
  return <dialog ref={ref} className="action-dialog campaign-detail" aria-labelledby="campaign-detail-title" onCancel={onCancel}>
    <div className="dialog-heading">
      <div><span className="eyebrow">Detail kampanye</span><h2 id="campaign-detail-title">{ad.title}</h2></div>
      <button type="button" className="icon-button" aria-label="Tutup detail" disabled={busy !== null} onClick={onClose}><Icon name="close" /></button>
    </div>
    <div className="dialog-body detail-layout">
      <DetailFacts ad={ad} />
      <div className="detail-preview"><PlacementPreview ad={{ title: ad.title, imageSrc: src, sponsorName }} /></div>
      <CampaignWeek ad={ad} />
      <div className="detail-danger">{danger.length > 0 && <DangerZone actions={danger} confirm={confirm} busy={busy} onAsk={setConfirm} onRun={a => { setConfirm(null); void run(a); }} />}</div>
    </div>
    <div className="dialog-footer detail-footer">
      {error && <p className="error-message" role="alert">{error}</p>}
      {main.find(a => a.disabledReason) && <p className="footer-note">{main.find(a => a.disabledReason)?.disabledReason}</p>}
      {ad.status === "PENDING_REVIEW" && <p className="footer-note">Ingin mengubah? Tarik pengajuan dulu, ubah, lalu ajukan lagi.</p>}
      <div className="footer-buttons">
        <button type="button" className="button secondary footer-close" disabled={busy !== null} onClick={onClose}>Tutup</button>
        {[...main].reverse().map(a => <button key={a.key} type="button" className={`button ${a.kind === "primary" ? "primary" : "secondary"}`} disabled={busy !== null || Boolean(a.disabledReason)} onClick={() => void run(a)}>
          {busy === a.key ? "Memproses…" : a.label}
        </button>)}
      </div>
    </div>
  </dialog>;
}

function DetailFacts({ ad }: { ad: AdDto }) {
  const today = wibToday();
  const start = wibDate(new Date(ad.startAt));
  return <div className="detail-facts">
    <div className="detail-status"><CampaignStatus status={ad.displayStatus} /><p>{statusNote(ad)}</p></div>
    {ad.displayStatus === "REJECTED" && ad.reviewNote && <p className="warning-message"><span><b>Catatan peninjau:</b> {ad.reviewNote}</span></p>}
    <dl className="fact-list">
      <Fact icon="calendar" term="Jadwal tayang">{scheduleRange(ad.startAt, ad.endAt, today)} <span className="muted">· {daysInclusive(start, lastDayOf(ad.endAt))} hari</span></Fact>
      <Fact icon="location" term="Jangkauan">{targetSummary(ad.targetScope, ad.targets)}{ad.targets.length > 2 && <TargetList targets={ad.targets} />}</Fact>
      <Fact icon="arrow" term="Tautan tujuan">{safeHref(ad.targetUrl) ? <a className="text-link" href={safeHref(ad.targetUrl) ?? undefined} target="_blank" rel="noopener noreferrer">{linkHost(ad.targetUrl)}</a> : <span>{ad.targetUrl}</span>} <span className="muted">· {label(ad.linkType)}</span></Fact>
      <Fact icon="wallet" term="Biaya per klik">{rupiah(ad.cpcAmount)} <span className="muted">· hanya klik sah yang ditagih</span></Fact>
      {ad.submittedAt && <Fact icon="history" term="Diajukan">{longDate(wibDate(new Date(ad.submittedAt)))}, {wibTime(ad.submittedAt)} WIB</Fact>}
      {ad.reviewedAt && <Fact icon="check" term="Ditinjau">{longDate(wibDate(new Date(ad.reviewedAt)))}, {wibTime(ad.reviewedAt)} WIB</Fact>}
    </dl>
  </div>;
}

function Fact({ icon, term, children }: { icon: string; term: string; children: ReactNode }) {
  return <div className="fact"><dt><Icon name={icon} size={17} />{term}</dt><dd>{children}</dd></div>;
}

function TargetList({ targets }: { targets: AdDto["targets"] }) {
  return <ul className="target-chips static">{targets.map(t => <li key={`${t.provinceCode}${t.cityCode}${t.schoolId}`} className="target-chip">{t.label}</li>)}</ul>;
}

interface DangerProps {
  readonly actions: readonly CampaignAction[];
  readonly confirm: CampaignAction | null;
  readonly busy: CampaignAction["key"] | null;
  readonly onAsk: (a: CampaignAction | null) => void;
  readonly onRun: (a: CampaignAction) => void;
}

function DangerZone({ actions, confirm, busy, onAsk, onRun }: DangerProps) {
  if (confirm) {
    return <div className="danger-confirm" role="alertdialog" aria-labelledby="danger-title" aria-describedby="danger-text">
      <strong id="danger-title">{confirm.label}?</strong>
      <p id="danger-text">{confirm.confirm}</p>
      <div className="confirm-buttons">
        <button type="button" className="button secondary small-button" onClick={() => onAsk(null)}>Batal</button>
        <button type="button" className="button danger small-button" disabled={busy !== null} onClick={() => onRun(confirm)}>Ya, {confirm.label.toLowerCase()}</button>
      </div>
    </div>;
  }
  return <div className="danger-row">{actions.map(a => <button key={a.key} type="button" className="text-button danger-text" disabled={busy !== null} onClick={() => onAsk(a)}>{a.label}</button>)}</div>;
}
