"use client";
import { useState } from "react";
import type { AdDto } from "@/lib/frontend/ad-types";
import { api } from "@/lib/frontend/api";
import { createBody, demoCreateAd, demoNotice, demoPatchAd, patchBody, validateDraft, type CampaignDraft, type CampaignField, type FieldErrors } from "@/lib/frontend/campaign-rules";
import { wibToday } from "@/lib/frontend/demo-ads";
import { useHub } from "../context";
import { explainFailure, runTransition } from "./campaign-data";

/**
 * Simpan editor kampanye: validasi klien -> POST (baru) / PATCH (hanya yang berubah) -> bila diminta
 * POST .../submit. Draf yang sudah dibuat tetap dipakai bila pengajuan gagal (tidak membuat duplikat).
 */
export type SaveMode = "draft" | "submit";
interface Stored { readonly ad: AdDto; readonly kind: "created" | "patched" | "unchanged"; readonly reReview: boolean }
interface SaveContext { readonly demo: boolean; readonly sponsorId: string; readonly cpc: number }

async function store(draft: CampaignDraft, saved: AdDto | null, ctx: SaveContext): Promise<Stored> {
  const nowIso = new Date().toISOString();
  if (!saved) {
    const ad = ctx.demo
      ? demoCreateAd(draft, { id: `demo-ad-${Date.now()}`, sponsorId: ctx.sponsorId, cpc: ctx.cpc, nowIso })
      : (await api("/sponsor/ads", { method: "POST", body: JSON.stringify(createBody(draft)) })).data as AdDto;
    return { ad, kind: "created", reReview: false };
  }
  const body = patchBody(draft, saved);
  if (!body) return { ad: saved, kind: "unchanged", reReview: false };
  const result = ctx.demo
    ? demoPatchAd(saved, draft, nowIso)
    : (await api(`/sponsor/ads/${encodeURIComponent(saved.id)}`, { method: "PATCH", body: JSON.stringify(body) })).data as { ad: AdDto; reReviewTriggered: boolean };
  return { ad: result.ad, kind: "patched", reReview: result.reReviewTriggered };
}

function doneMessage(mode: SaveMode, stored: Stored, demo: boolean): string {
  const text = mode === "submit" ? "Kampanye diajukan untuk ditinjau."
    : stored.kind === "created" ? "Draf kampanye tersimpan."
    : stored.kind === "unchanged" ? "Tidak ada perubahan untuk disimpan."
    : stored.reReview ? "Perubahan disimpan. Kampanye ditinjau ulang sebelum tayang lagi."
    : "Perubahan disimpan.";
  return demo ? demoNotice(text) : text;
}

function focusField(field: CampaignField) {
  requestAnimationFrame(() => {
    const element = document.getElementById(`campaign-${field}`);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: "center" });
  });
}
const ORDER: readonly CampaignField[] = ["banner", "title", "targetUrl", "targets", "schedule"];

interface SaveProps {
  readonly ad: AdDto | null;
  readonly cpc: number;
  readonly onUpsert: (ad: AdDto) => void;
  readonly onClose: () => void;
  /** Galat basi: versi terbaru sudah dimuat; editor menyelaraskan drafnya (before = versi yang dipakai saat simpan). */
  readonly onRebase: (before: AdDto, latest: AdDto) => void;
}

export function useCampaignSave({ ad, cpc, onUpsert, onClose, onRebase }: SaveProps) {
  const { demo, toast, me } = useHub();
  const [saved, setSaved] = useState<AdDto | null>(ad);
  const [busy, setBusy] = useState<SaveMode | null>(null);
  const [errors, setErrors] = useState<FieldErrors<CampaignField>>({});
  const [general, setGeneral] = useState("");
  async function save(draft: CampaignDraft, mode: SaveMode) {
    const found = validateDraft(draft, mode, wibToday());
    setErrors(found); setGeneral("");
    const first = ORDER.find(f => found[f]);
    if (first) { focusField(first); return; }
    setBusy(mode);
    let base = saved;
    try {
      const stored = await store(draft, base, { demo, sponsorId: me.sponsor?.id ?? "demo-sponsor", cpc });
      base = stored.ad;
      setSaved(stored.ad);
      if (stored.kind !== "unchanged") onUpsert(stored.ad);
      if (mode === "submit") onUpsert(await runTransition(stored.ad, "submit", demo));
      toast(doneMessage(mode, stored, demo));
      onClose();
    } catch (e) {
      const { failure, latest } = await explainFailure(e, base?.id ?? null, demo);
      if (latest && base) { setSaved(latest); onUpsert(latest); onRebase(base, latest); }
      if (failure.field === "general") setGeneral(failure.message);
      else { setErrors({ [failure.field]: failure.message }); focusField(failure.field); }
    } finally { setBusy(null); }
  }
  const clear = (fields: readonly CampaignField[]) => setErrors(prev => (fields.some(f => prev[f]) ? Object.fromEntries(Object.entries(prev).filter(([k]) => !fields.includes(k as CampaignField))) : prev));
  return { saved, busy, errors, general, save, clear, setErrors };
}
