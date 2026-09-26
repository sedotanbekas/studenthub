"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AdDto } from "@/lib/frontend/ad-types";
import { SUBMIT_BLOCKED, draftFromAd, emptyDraft, rebaseDraft, type CampaignDraft, type CampaignField } from "@/lib/frontend/campaign-rules";
import { wibToday } from "@/lib/frontend/demo-ads";
import { PlacementPreview } from "../ads/placement-preview";
import { useHub } from "../context";
import { Icon } from "../icon";
import { BANNER_PLACEHOLDER, BannerPicker } from "./campaign-banner";
import { useModal, type CampaignData } from "./campaign-data";
import { CostNote, EditorSection, LinkField, ScheduleField, TitleField } from "./campaign-fields";
import { useCampaignSave, type SaveMode } from "./campaign-save";
import { TargetPicker } from "./campaign-targets";
import type { BannerResolver } from "./campaigns-page";

/**
 * Editor kampanye (buat/ubah) sebagai dialog — layar penuh di HP. Formulir di kiri, pratinjau penempatan
 * LANGSUNG di kanan (di bawah pada HP) yang mengikuti setiap ketikan, banner, dan nama sponsor.
 */
interface EditorProps {
  readonly ad: AdDto | null;
  readonly data: CampaignData;
  readonly sponsorName: string;
  readonly srcOf: BannerResolver;
  readonly onLocalBanner: (fileId: string, url: string) => void;
  readonly onUpsert: (ad: AdDto) => void;
  readonly onClose: () => void;
}

const FIELD_OF: Readonly<Record<keyof CampaignDraft, CampaignField>> = {
  title: "title", imageFileId: "banner", linkType: "targetUrl", targetUrl: "targetUrl", scope: "targets", targets: "targets", startDate: "schedule", endDate: "schedule",
};

/** Pratinjau object URL (banner baru) dilepas saat diganti/ditutup; di demo dipakai kartu daftar sehingga dibiarkan. */
function usePreviewUrl(demo: boolean) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => () => { if (!demo && preview) URL.revokeObjectURL(preview); }, [demo, preview]);
  return [preview, setPreview] as const;
}

/**
 * Hasil unggah banner yang tiba SETELAH editor ditutup (unggahan tetap berjalan) diabaikan dan object
 * URL-nya dilepas; selama editor terbuka diteruskan ke `onPicked`/`onLocalBanner` seperti biasa.
 */
function useBannerResults(onPicked: (fileId: string, url: string | null) => void, onLocalBanner: (fileId: string, url: string) => void) {
  const closed = useRef(false);
  useEffect(() => {
    closed.current = false;
    return () => { closed.current = true; };
  }, []);
  const ignored = (url: string | null) => {
    if (!closed.current) return false;
    if (url) URL.revokeObjectURL(url);
    return true;
  };
  return {
    picked: (fileId: string, url: string | null) => { if (!ignored(url)) onPicked(fileId, url); },
    local: (fileId: string, url: string) => { if (!ignored(url)) onLocalBanner(fileId, url); },
  };
}

export function CampaignEditor(props: EditorProps) {
  const { ad, data, sponsorName, srcOf, onClose } = props;
  const { demo } = useHub();
  const [draft, setDraft] = useState<CampaignDraft>(() => (ad ? draftFromAd(ad) : emptyDraft(wibToday())));
  const [preview, setPreview] = usePreviewUrl(demo);
  const [uploading, setUploading] = useState(false);
  const { saved, busy, errors, general, save, clear, setErrors } = useCampaignSave({
    ad, cpc: data.balance?.defaultCpcAmount ?? ad?.cpcAmount ?? 0, onUpsert: props.onUpsert, onClose,
    onRebase: (before, latest) => setDraft(d => rebaseDraft(d, before, latest)),
  });
  const { ref, onCancel } = useModal(onClose, busy !== null);
  const change = (patch: Partial<CampaignDraft>) => {
    setDraft(d => ({ ...d, ...patch }));
    clear((Object.keys(patch) as (keyof CampaignDraft)[]).map(k => FIELD_OF[k]));
  };
  const banner = useBannerResults((fileId, url) => { setPreview(url); change({ imageFileId: fileId }); }, props.onLocalBanner);
  const imageSrc = preview ?? (draft.imageFileId ? srcOf({ imageFileId: draft.imageFileId, imageUrl: draft.imageFileId === saved?.imageFileId ? saved.imageUrl : null }) : BANNER_PLACEHOLDER);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const mode = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("data-mode") === "submit" ? "submit" : "draft";
    if (!uploading) void save(draft, mode);
  };
  return <dialog ref={ref} className="action-dialog campaign-editor" aria-labelledby="campaign-editor-title" onCancel={onCancel}>
    <form noValidate onSubmit={onSubmit}>
      <EditorHeading saved={saved} busy={busy !== null} onClose={onClose} />
      <div className="dialog-body editor-layout">
        <div className="editor-form">
          <EditorNotices saved={saved} data={data} />
          <EditorSection step={1} title="Banner" hint="Gambar utama kartu sponsor.">
            <BannerPicker src={imageSrc} hasBanner={Boolean(draft.imageFileId)} error={errors.banner} onBusy={setUploading} onLocalBanner={banner.local}
              onError={message => setErrors(prev => ({ ...prev, banner: message }))} onPicked={banner.picked} />
          </EditorSection>
          <EditorSection step={2} title="Judul"><TitleField value={draft.title} error={errors.title} onChange={change} /></EditorSection>
          <EditorSection step={3} title="Tujuan klik" hint="Halaman yang dibuka saat siswa mengetuk kartu."><LinkField linkType={draft.linkType} value={draft.targetUrl} error={errors.targetUrl} onChange={change} /></EditorSection>
          <EditorSection step={4} title="Jangkauan" hint="Sekolah mana yang melihat kampanye ini."><TargetPicker scope={draft.scope} targets={draft.targets} error={errors.targets} onChange={change} /></EditorSection>
          <EditorSection step={5} title="Jadwal"><ScheduleField startDate={draft.startDate} endDate={draft.endDate} minStart={saved ? undefined : wibToday()} error={errors.schedule} onChange={change} /></EditorSection>
          <EditorSection step={6} title="Biaya"><CostNote cpc={data.balance?.defaultCpcAmount ?? saved?.cpcAmount ?? null} balance={data.balance} /></EditorSection>
        </div>
        <aside className="editor-preview" id="campaign-live-preview" aria-label="Pratinjau langsung">
          <span className="eyebrow">Pratinjau langsung</span>
          <PlacementPreview key={imageSrc} ad={{ title: draft.title.trim() || "Judul kampanye Anda", imageSrc, sponsorName }} />
        </aside>
      </div>
      <EditorFooter saved={saved} data={data} busy={busy} uploading={uploading} general={general} invalid={Object.values(errors).filter(Boolean).length} onClose={onClose} />
    </form>
  </dialog>;
}

function EditorHeading({ saved, busy, onClose }: { saved: AdDto | null; busy: boolean; onClose: () => void }) {
  return <div className="dialog-heading">
    <div><span className="eyebrow">{saved ? "Ubah kampanye" : "Kampanye baru"}</span><h2 id="campaign-editor-title">{saved ? saved.title : "Buat kampanye"}</h2></div>
    <div className="editor-heading-actions">
      <button type="button" className="text-button preview-jump" onClick={() => document.getElementById("campaign-live-preview")?.scrollIntoView({ block: "start" })}>Pratinjau</button>
      <button type="button" className="icon-button" aria-label="Tutup editor" disabled={busy} onClick={onClose}><Icon name="close" /></button>
    </div>
  </div>;
}

function EditorNotices({ saved, data }: { saved: AdDto | null; data: CampaignData }) {
  const live = saved && (saved.status === "APPROVED" || saved.status === "PAUSED");
  return <>
    {live && <p className="info-message">Mengubah banner, tautan, atau jangkauan akan mengirim kampanye untuk ditinjau ulang; selama ditinjau, kampanye tidak tayang. Judul dan jadwal bisa diubah tanpa tinjauan ulang.</p>}
    {saved?.status === "REJECTED" && saved.reviewNote && <p className="warning-message"><span><b>Catatan peninjau:</b> {saved.reviewNote}</span></p>}
    {data.sponsorStatus === "PENDING" && <p className="info-message">{SUBMIT_BLOCKED}</p>}
  </>;
}

interface FooterProps { readonly saved: AdDto | null; readonly data: CampaignData; readonly busy: SaveMode | null; readonly uploading: boolean; readonly general: string; readonly invalid: number; readonly onClose: () => void }

function EditorFooter({ saved, data, busy, uploading, general, invalid, onClose }: FooterProps) {
  const live = saved !== null && (saved.status === "APPROVED" || saved.status === "PAUSED");
  const blocked = data.sponsorStatus === "PENDING";
  const disabled = busy !== null || uploading;
  return <div className="dialog-footer editor-footer">
    {general && <p className="error-message" role="alert">{general}</p>}
    {invalid > 0 && <p className="footer-note is-error" role="alert">Periksa {invalid} isian yang ditandai merah.</p>}
    {uploading && <p className="footer-note" role="status">Tunggu banner selesai diunggah…</p>}
    <div className="footer-buttons">
      <button type="button" className="button secondary footer-close" disabled={busy !== null} onClick={onClose}>Batal</button>
      {live
        ? <button type="submit" data-mode="draft" className="button primary" disabled={disabled}>{busy ? "Menyimpan…" : "Simpan perubahan"}</button>
        : <>
          <button type="submit" data-mode="draft" className="button secondary" disabled={disabled}>{busy === "draft" ? "Menyimpan…" : "Simpan draf"}</button>
          <button type="submit" data-mode="submit" className="button primary" disabled={disabled || blocked} title={blocked ? SUBMIT_BLOCKED : undefined}>{busy === "submit" ? "Mengajukan…" : "Simpan & ajukan tinjauan"}</button>
        </>}
    </div>
  </div>;
}
