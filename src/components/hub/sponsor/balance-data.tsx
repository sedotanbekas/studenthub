"use client";
import { useCallback, useEffect, useState } from "react";
import type { AdDto, AnalyticsSummary, LedgerEntryDto, SponsorBalanceDto, SponsorDto, TopUpDto } from "@/lib/frontend/ad-types";
import { api } from "@/lib/frontend/api";
import { appendById } from "@/lib/frontend/campaign-rules";
import { demoAnalyticsSummary, demoBalance, demoLedger, demoSponsorAds, demoSponsorProfile, demoTopUps } from "@/lib/frontend/demo-ads";
import { useHub } from "../context";
import { failureOf, type SponsorStatus } from "./campaign-data";

/**
 * Data halaman "Saldo & top-up": ringkasan saldo, riwayat top-up, status akun (gerbang top-up), biaya
 * 7 hari (perkiraan lama saldo cukup), judul kampanye (label potongan klik), dan ledger berhalaman.
 */
export interface BalanceData {
  readonly balance: SponsorBalanceDto;
  readonly topUps: readonly TopUpDto[];
  readonly sponsorStatus: SponsorStatus | null;
  readonly spend7d: number | null;
  readonly adTitles: Readonly<Record<string, string>>;
}
export type BalanceState = { readonly kind: "loading" } | { readonly kind: "error"; readonly message: string } | { readonly kind: "ready"; readonly data: BalanceData };

const titlesOf = (ads: readonly AdDto[]) => Object.fromEntries(ads.map(a => [a.id, a.title]));

async function loadBalance(demo: boolean): Promise<BalanceData> {
  if (demo) return { balance: demoBalance(), topUps: demoTopUps(), sponsorStatus: demoSponsorProfile().status, spend7d: demoAnalyticsSummary("7d").kpis.spend.value, adTitles: titlesOf(demoSponsorAds()) };
  const [balance, topUps, profile, summary, ads] = await Promise.all([
    api("/sponsor/balance").then(r => r.data as SponsorBalanceDto),
    api("/sponsor/topups?limit=20").then(r => r.data as TopUpDto[]),
    api("/sponsor/profile").then(r => r.data as SponsorDto).catch(() => null),
    api("/sponsor/analytics/summary?preset=7d").then(r => r.data as AnalyticsSummary).catch(() => null),
    api("/sponsor/ads?limit=100").then(r => r.data as AdDto[]).catch(() => []),
  ]);
  return { balance, topUps, sponsorStatus: profile?.status ?? null, spend7d: summary?.kpis.spend.value ?? null, adTitles: titlesOf(ads) };
}

export function useBalanceData() {
  const { demo } = useHub();
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<BalanceState>({ kind: "loading" });
  useEffect(() => {
    let active = true;
    loadBalance(demo)
      .then(data => { if (active) setState({ kind: "ready", data }); })
      .catch(e => { if (active) setState({ kind: "error", message: failureOf(e).message }); });
    return () => { active = false; };
  }, [demo, version]);
  const reload = useCallback(() => { setState({ kind: "loading" }); setVersion(v => v + 1); }, []);
  const update = useCallback((change: (data: BalanceData) => BalanceData) => setState(s => (s.kind === "ready" ? { kind: "ready", data: change(s.data) } : s)), []);
  return { state, reload, update };
}

export async function cancelTopUp(topUp: TopUpDto, demo: boolean): Promise<TopUpDto> {
  if (demo) return { ...topUp, status: "CANCELLED" };
  return (await api(`/sponsor/topups/${encodeURIComponent(topUp.id)}/cancel`, { method: "POST" })).data as TopUpDto;
}

export type LedgerType = "ALL" | LedgerEntryDto["type"];
const LEDGER_LIMIT = 20;
interface LedgerPage { readonly rows: readonly LedgerEntryDto[]; readonly totalPages: number }
interface LedgerState { readonly type: LedgerType; readonly page: number; readonly rows: readonly LedgerEntryDto[]; readonly totalPages: number; readonly loading: boolean; readonly error: string }

async function fetchLedger(type: LedgerType, page: number, demo: boolean): Promise<LedgerPage> {
  if (demo) {
    const all = demoLedger().filter(e => type === "ALL" || e.type === type);
    return { rows: all.slice((page - 1) * LEDGER_LIMIT, page * LEDGER_LIMIT), totalPages: Math.max(1, Math.ceil(all.length / LEDGER_LIMIT)) };
  }
  const response = await api(`/sponsor/ledger?page=${page}&limit=${LEDGER_LIMIT}${type === "ALL" ? "" : `&type=${type}`}`);
  return { rows: response.data as LedgerEntryDto[], totalPages: response.meta?.totalPages ?? 1 };
}

/** Ledger per jenis dengan "Muat lebih banyak"; ganti jenis = mulai dari halaman 1. */
export function useLedger() {
  const { demo } = useHub();
  const [query, setQuery] = useState<{ type: LedgerType; page: number; attempt: number }>({ type: "ALL", page: 1, attempt: 0 });
  const [state, setState] = useState<LedgerState>({ type: "ALL", page: 0, rows: [], totalPages: 1, loading: true, error: "" });
  useEffect(() => {
    let active = true;
    fetchLedger(query.type, query.page, demo)
      // Paginasi offset: mutasi baru menggeser halaman berikutnya, jadi baris yang sudah tampil dilewati (id unik).
      .then(result => { if (active) setState(s => ({ type: query.type, page: query.page, rows: query.page === 1 ? result.rows : appendById(s.rows, result.rows), totalPages: result.totalPages, loading: false, error: "" })); })
      .catch(e => { if (active) setState(s => ({ ...s, loading: false, error: failureOf(e).message })); });
    return () => { active = false; };
  }, [demo, query]);
  const setType = (type: LedgerType) => { setState(s => ({ ...s, type, rows: [], loading: true, error: "" })); setQuery({ type, page: 1, attempt: 0 }); };
  const more = () => { setState(s => ({ ...s, loading: true, error: "" })); setQuery(q => ({ ...q, page: state.page + 1 })); };
  const retry = () => { setState(s => ({ ...s, loading: true, error: "" })); setQuery(q => ({ ...q, attempt: q.attempt + 1 })); };
  return { ...state, hasMore: state.page > 0 && state.page < state.totalPages, setType, more, retry };
}
