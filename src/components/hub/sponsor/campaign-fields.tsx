"use client";
import type { ReactNode } from "react";
import { AD_TITLE_MAX } from "@/lib/ads/constants";
import type { AdLinkType, SponsorBalanceDto } from "@/lib/frontend/ad-types";
import { linkHost } from "@/lib/frontend/ad-media";
import {
  SCHEDULE_DATE_MAX, SCHEDULE_DATE_MIN, isScheduleDate, linkProblem, normalizeLinkInput, quickEndDate, scheduleDateProblem, scheduleDays, scheduleHint, type CampaignDraft,
} from "@/lib/frontend/campaign-rules";
import { number, rupiah } from "@/lib/frontend/format";
import { Segmented } from "../charts/segmented";
import { HubLink } from "../hub-link";
import { Icon } from "../icon";

/** Bagian-bagian formulir editor kampanye (judul, tautan, jadwal, biaya). Id `campaign-<field>` = target fokus galat. */
type Patch = (patch: Partial<CampaignDraft>) => void;

export function EditorSection({ step, title, hint, children }: { step: number; title: string; hint?: string; children: ReactNode }) {
  const id = `editor-step-${step}`;
  return <section className="editor-section" aria-labelledby={id}>
    <div className="section-head"><span className="step" aria-hidden="true">{step}</span><div><h3 id={id}>{title}</h3>{hint && <p>{hint}</p>}</div></div>
    {children}
  </section>;
}

export function FieldError({ id, error }: { id: string; error: string | undefined }) {
  return error ? <small className="field-error" id={`${id}-error`} role="alert">{error}</small> : null;
}

const describedBy = (id: string, error: string | undefined) => `${id}-hint${error ? ` ${id}-error` : ""}`;

export function TitleField({ value, error, onChange }: { value: string; error?: string; onChange: Patch }) {
  const id = "campaign-title";
  return <div className="field">
    <label htmlFor={id}>Judul kampanye</label>
    <input id={id} value={value} maxLength={AD_TITLE_MAX} autoComplete="off" placeholder="mis. Tryout UTBK gratis setiap Sabtu" aria-invalid={Boolean(error)} aria-describedby={describedBy(id, error)} onChange={e => onChange({ title: e.target.value })} />
    <span className="field-foot"><small className="field-hint" id={`${id}-hint`}>Singkat dan jelas; tampil di bawah banner.</small><small className="counter" aria-live="polite">{value.length}/{AD_TITLE_MAX}</small></span>
    <FieldError id={id} error={error} />
  </div>;
}

const LINK_TYPES: readonly { value: AdLinkType; label: string }[] = [{ value: "EXTERNAL_URL", label: "Situs web" }, { value: "DEEP_LINK", label: "Aplikasi" }];

function linkHint(linkType: AdLinkType, url: string): string {
  if (linkType === "DEEP_LINK") return "Skema aplikasi harus sudah diizinkan admin Student Hub.";
  return url && !linkProblem(linkType, url) ? `Siswa dibuka ke ${linkHost(url)} di tab baru.` : "Hanya tautan https:// yang bisa dibuka dengan aman dari HP siswa.";
}

export function LinkField({ linkType, value, error, onChange }: { linkType: AdLinkType; value: string; error?: string; onChange: Patch }) {
  const id = "campaign-targetUrl";
  return <div className="field">
    <span className="field-label">Jenis tautan</span>
    <Segmented options={LINK_TYPES} value={linkType} onChange={next => onChange({ linkType: next })} ariaLabel="Jenis tautan" />
    <label htmlFor={id} className="field-label">Tautan tujuan</label>
    <input id={id} type="url" inputMode="url" autoComplete="url" spellCheck={false} value={value} placeholder={linkType === "EXTERNAL_URL" ? "https://contoh.id/halaman" : "namaaplikasi://halaman"}
      aria-invalid={Boolean(error)} aria-describedby={describedBy(id, error)} onChange={e => onChange({ targetUrl: e.target.value })} onBlur={() => onChange({ targetUrl: normalizeLinkInput(linkType, value) })} />
    <small className="field-hint" id={`${id}-hint`}>{linkHint(linkType, value)}</small>
    <FieldError id={id} error={error} />
  </div>;
}

const DURATIONS = [7, 14, 30] as const;

/**
 * Jadwal tayang. Input date bisa menerima tahun 5 digit (mis. 20261) — nilai seperti itu tidak pernah
 * diteruskan ke aritmetika tanggal (yang melempar RangeError); tampil "Tanggal tidak valid" saja.
 */
export function ScheduleField({ startDate, endDate, minStart, error, onChange }: { startDate: string; endDate: string; minStart?: string; error?: string; onChange: Patch }) {
  const id = "campaign-schedule";
  const days = scheduleDays(startDate, endDate);
  const shownError = error ?? scheduleDateProblem(startDate, endDate) ?? undefined;
  const endMin = isScheduleDate(startDate) ? startDate : SCHEDULE_DATE_MIN;
  const dateProps = { type: "date", max: SCHEDULE_DATE_MAX, "aria-invalid": Boolean(shownError), "aria-describedby": describedBy(id, shownError) } as const;
  return <div className="field">
    <div className="schedule-grid">
      <label className="field"><span>Mulai</span><input id={id} {...dateProps} value={startDate} min={minStart ?? SCHEDULE_DATE_MIN} onChange={e => onChange({ startDate: e.target.value })} /></label>
      <label className="field"><span>Selesai</span><input id="campaign-end" {...dateProps} value={endDate} min={endMin} onChange={e => onChange({ endDate: e.target.value })} /></label>
    </div>
    <div className="duration-chips" role="group" aria-label="Durasi cepat">
      {DURATIONS.map(n => {
        const end = quickEndDate(startDate, n);
        return <button key={n} type="button" className="mini-chip" aria-pressed={days === n} disabled={end === null} onClick={() => { if (end) onChange({ endDate: end }); }}>{n} hari</button>;
      })}
    </div>
    <small className="field-hint" id={`${id}-hint`}>{scheduleHint(startDate, endDate)}</small>
    <FieldError id={id} error={shownError} />
  </div>;
}

export function CostNote({ cpc, balance }: { cpc: number | null; balance: SponsorBalanceDto | null }) {
  return <div className="cost-note">
    <span className="cost-icon" aria-hidden="true"><Icon name="wallet" size={20} /></span>
    <div>
      <strong>{cpc ? `${rupiah(cpc)} per klik` : "Tarif per klik mengikuti platform"}</strong>
      <p>Dibayar per klik sah; tayangan tidak ditagih. Klik berulang dari siswa yang sama di hari yang sama tidak ditagih lagi.</p>
      {balance && <p className="muted">Saldo saat ini {rupiah(balance.balance)} ≈ {number(balance.estimatedClicksRemaining)} klik. <HubLink className="text-link" href="/hub/balance">Isi saldo</HubLink></p>}
    </div>
  </div>;
}
