"use client";
import { useState } from "react";
import type { TopUpDto } from "@/lib/frontend/ad-types";
import type { Module } from "@/lib/frontend/types";
import { BalanceHero } from "./balance-hero";
import { useBalanceData, type BalanceData } from "./balance-data";
import { TopUpHistory } from "./balance-history";
import { LedgerPanel } from "./balance-ledger";
import { TopUpPanel } from "./balance-topup-form";

/** "Saldo & top-up" (sponsor): kartu saldo, formulir top-up dengan bukti, riwayat top-up, dan mutasi saldo. */
const pendingOf = (topUps: readonly TopUpDto[]) => topUps.filter(t => t.status === "PENDING").length;

export function BalancePage({ module }: { module: Module }) {
  const { state, reload, update } = useBalanceData();
  const [localProofs, setLocalProofs] = useState<Readonly<Record<string, string>>>({});
  const replaceTopUp = (topUp: TopUpDto) => update(d => withTopUps(d, d.topUps.map(t => (t.id === topUp.id ? topUp : t))));
  const addTopUp = (topUp: TopUpDto, proofUrl: string | null) => {
    if (proofUrl) setLocalProofs(prev => ({ ...prev, [topUp.id]: proofUrl }));
    update(d => withTopUps(d, [topUp, ...d.topUps]));
  };
  return <div className="workspace-page balance-page">
    <div className="page-heading"><div><h1>{module.title}</h1><p>{module.description}</p></div></div>
    {state.kind === "loading" ? <div className="panel" aria-busy="true" aria-label="Memuat saldo"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>
      : state.kind === "error" ? <div className="error-message" role="alert">{state.message}<button type="button" className="text-button" onClick={reload}>Coba lagi</button></div>
      : <>
        <BalanceHero balance={state.data.balance} spend7d={state.data.spend7d} />
        <div className="balance-grid">
          <TopUpPanel balance={state.data.balance} sponsorStatus={state.data.sponsorStatus} onSubmitted={addTopUp} />
          <div className="balance-side">
            <TopUpHistory topUps={state.data.topUps} localProofs={localProofs} sponsorStatus={state.data.sponsorStatus} onChanged={replaceTopUp} />
            <LedgerPanel adTitles={state.data.adTitles} />
          </div>
        </div>
      </>}
  </div>;
}

/** Daftar top-up baru + jumlah menunggu diselaraskan (gerbang maks 3 pengajuan menunggu). */
function withTopUps(data: BalanceData, topUps: readonly TopUpDto[]): BalanceData {
  return { ...data, topUps, balance: { ...data.balance, pendingTopUps: pendingOf(topUps) } };
}
