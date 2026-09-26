"use client";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { api, ApiError } from "@/lib/frontend/api";
import type { AdDto, AdPerformanceDto, SponsorBalanceDto, SponsorDto } from "@/lib/frontend/ad-types";
import {
  STALE_RELOAD_FAILED, appendById, applyDemoAction, campaignFailure, isStaleCampaign, type ApiFailure, type CampaignField, type Failure, type TransitionKey,
} from "@/lib/frontend/campaign-rules";
import { demoAdPerformance, demoBalance, demoSponsorAd, demoSponsorAds, demoSponsorProfile } from "@/lib/frontend/demo-ads";
import { useHub } from "../context";

/**
 * Data halaman "Kampanye saya": daftar kampanye (paginasi 100), status akun sponsor (gerbang ajukan),
 * saldo (CPC & perkiraan klik), dan performa 7 hari per kampanye. Mode demo tidak memanggil API.
 */
export type SponsorStatus = SponsorDto["status"];
export interface CampaignData {
  readonly ads: readonly AdDto[];
  readonly sponsorStatus: SponsorStatus | null;
  readonly balance: SponsorBalanceDto | null;
  readonly performance: Readonly<Record<string, AdPerformanceDto>>;
  readonly page: number;
  readonly totalPages: number;
}
export type CampaignState = { readonly kind: "loading" } | { readonly kind: "error"; readonly message: string } | { readonly kind: "ready"; readonly data: CampaignData };

const PAGE_LIMIT = 100;

export function failureOf(e: unknown): ApiFailure {
  if (e instanceof ApiError) return { code: e.code, message: e.message, details: e.details };
  return { code: "UNKNOWN", message: e instanceof Error ? e.message : "Permintaan gagal. Silakan coba lagi." };
}

const byId = (rows: readonly AdPerformanceDto[]): Record<string, AdPerformanceDto> => Object.fromEntries(rows.map(r => [r.adId, r]));

async function fetchAds(page: number): Promise<{ ads: AdDto[]; totalPages: number }> {
  const response = await api(`/sponsor/ads?page=${page}&limit=${PAGE_LIMIT}`);
  return { ads: response.data as AdDto[], totalPages: response.meta?.totalPages ?? 1 };
}

async function loadCampaigns(demo: boolean): Promise<CampaignData> {
  if (demo) return { ads: demoSponsorAds(), sponsorStatus: demoSponsorProfile().status, balance: demoBalance(), performance: byId(demoAdPerformance("7d")), page: 1, totalPages: 1 };
  const [first, profile, balance, performance] = await Promise.all([
    fetchAds(1),
    api("/sponsor/profile").then(r => r.data as SponsorDto).catch(() => null),
    api("/sponsor/balance").then(r => r.data as SponsorBalanceDto).catch(() => null),
    api(`/sponsor/analytics/ads?preset=7d&limit=${PAGE_LIMIT}`).then(r => r.data as AdPerformanceDto[]).catch(() => []),
  ]);
  return { ads: first.ads, sponsorStatus: profile?.status ?? null, balance, performance: byId(performance), page: 1, totalPages: first.totalPages };
}

export function useCampaignData() {
  const { demo } = useHub();
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<CampaignState>({ kind: "loading" });
  useEffect(() => {
    let active = true;
    loadCampaigns(demo)
      .then(data => { if (active) setState({ kind: "ready", data }); })
      .catch(e => { if (active) setState({ kind: "error", message: failureOf(e).message }); });
    return () => { active = false; };
  }, [demo, version]);
  const reload = useCallback(() => { setState({ kind: "loading" }); setVersion(v => v + 1); }, []);
  const updateAds = useCallback((change: (ads: readonly AdDto[]) => readonly AdDto[]) => {
    setState(s => (s.kind === "ready" ? { kind: "ready", data: { ...s.data, ads: change(s.data.ads) } } : s));
  }, []);
  return { state, reload, updateAds, loadMore: useLoadMore(state, setState) };
}

/** Halaman berikutnya ditambahkan ke daftar (duplikat id diabaikan). */
function useLoadMore(state: CampaignState, setState: (update: (s: CampaignState) => CampaignState) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const next = state.kind === "ready" && state.data.page < state.data.totalPages ? state.data.page + 1 : null;
  const load = useCallback(async () => {
    if (next === null) return;
    setBusy(true); setError("");
    try {
      const { ads, totalPages } = await fetchAds(next);
      setState(s => (s.kind === "ready" ? { kind: "ready", data: { ...s.data, ads: appendById(s.data.ads, ads), page: next, totalPages } } : s));
    } catch (e) { setError(failureOf(e).message); } finally { setBusy(false); }
  }, [next, setState]);
  return { available: next !== null, busy, error, load };
}

/** Transisi status (ajukan, tarik, jeda, lanjutkan, arsipkan); demo disimulasikan lokal. */
export async function runTransition(ad: AdDto, key: TransitionKey, demo: boolean): Promise<AdDto> {
  if (demo) return applyDemoAction(ad, key, new Date().toISOString());
  const response = await api(`/sponsor/ads/${encodeURIComponent(ad.id)}/${key}`, { method: "POST" });
  return response.data as AdDto;
}

export async function deleteCampaign(ad: AdDto, demo: boolean): Promise<void> {
  if (demo) return;
  await api(`/sponsor/ads/${encodeURIComponent(ad.id)}`, { method: "DELETE" });
}

/** Versi terbaru satu kampanye (GET /sponsor/ads/{id}); demo dari data contoh (null bila kampanye lokal). */
export async function fetchCampaign(id: string, demo: boolean): Promise<AdDto | null> {
  if (demo) return demoSponsorAd(id);
  return (await api(`/sponsor/ads/${encodeURIComponent(id)}`)).data as AdDto;
}

/**
 * Galat aksi/simpan kampanye -> pesan per field. Galat basi (STATE_CONFLICT/AD_INVALID_TRANSITION) memuat
 * versi terbaru kampanye `id` agar pemanggil bisa memperbarui daftar & draf lalu pengguna mencoba lagi.
 */
export async function explainFailure(e: unknown, id: string | null, demo: boolean): Promise<{ failure: Failure<CampaignField>; latest: AdDto | null }> {
  const raw = failureOf(e);
  if (!id || !isStaleCampaign(raw)) return { failure: campaignFailure(raw), latest: null };
  const latest = await fetchCampaign(id, demo).catch(() => null);
  return { failure: latest ? campaignFailure(raw) : { field: "general", message: STALE_RELOAD_FAILED }, latest };
}

/**
 * Buka `<dialog>` modal saat dipasang; Escape memanggil onClose kecuali sedang sibuk. Chrome menutup
 * dialog TANPA `cancel` bila Escape ditekan dua kali tanpa aktivasi pengguna di antaranya; event `close`
 * itu disinkronkan: saat sibuk dialog dibuka lagi, selain itu state induk ditutup (tombol pembuka tetap hidup).
 */
export function useModal(onClose: () => void, busy: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  const onNativeClose = useEffectEvent((element: HTMLDialogElement) => {
    if (busy && element.isConnected) element.showModal();
    else onClose();
  });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.showModal();
    // Event `close` dikirim asinkron: yang tiba saat dialog sudah terbuka lagi (StrictMode) diabaikan.
    const handle = () => { if (!element.open) onNativeClose(element); };
    element.addEventListener("close", handle);
    return () => { element.removeEventListener("close", handle); element.close(); };
  }, []);
  const onCancel = (event: { preventDefault: () => void }) => { event.preventDefault(); if (!busy) onClose(); };
  return { ref, onCancel };
}
