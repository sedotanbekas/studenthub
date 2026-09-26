"use client";
import type { SponsorBalanceDto } from "@/lib/frontend/ad-types";
import { remainingShare, runwayDays, signedRupiah } from "@/lib/frontend/campaign-rules";
import { number, rupiah } from "@/lib/frontend/format";
import { Icon } from "../icon";

/**
 * Kartu saldo bergradien: saldo, perkiraan sisa klik, porsi dana tersisa, perkiraan lama saldo cukup
 * (rata-rata biaya 7 hari), serta total top-up / terpakai / penyesuaian. Saldo menipis -> peringatan.
 */
export function BalanceHero({ balance, spend7d }: { balance: SponsorBalanceDto; spend7d: number | null }) {
  const share = remainingShare(balance.balance, balance.totalTopUp, balance.netAdjustment);
  const runway = spend7d === null ? null : runwayDays(balance.balance, spend7d);
  const low = balance.balance < balance.lowBalanceThreshold;
  return <>
    <section className="balance-hero" aria-labelledby="balance-hero-title">
      <div className="hero-top">
        <span className="kicker" id="balance-hero-title">Saldo iklan</span>
        {balance.pendingTopUps > 0 && <span className="hero-chip"><Icon name="history" size={15} />{balance.pendingTopUps} top-up menunggu verifikasi</span>}
      </div>
      <strong className="hero-amount">{rupiah(balance.balance)}</strong>
      <p className="hero-sub">≈ {number(balance.estimatedClicksRemaining)} klik lagi dengan tarif {rupiah(balance.defaultCpcAmount)} per klik</p>
      <div className="hero-meter" role="img" aria-label={`Sisa ${Math.round(share * 100)}% dari seluruh dana masuk`}><span style={{ width: `${Math.max(share * 100, share > 0 ? 2 : 0)}%` }} /></div>
      <p className="hero-runway">{runway === null ? "Belum ada pemakaian dalam 7 hari terakhir." : `Cukup untuk ± ${number(runway)} hari dengan pemakaian rata-rata ${rupiah(Math.round((spend7d ?? 0) / 7))} per hari (7 hari terakhir).`}</p>
      <dl className="hero-figures">
        <div><dt>Total top-up</dt><dd>{rupiah(balance.totalTopUp)}</dd></div>
        <div><dt>Total terpakai</dt><dd>{rupiah(balance.totalSpent)}</dd></div>
        <div><dt>Penyesuaian</dt><dd>{signedRupiah(balance.netAdjustment)}</dd></div>
      </dl>
    </section>
    {low && <p className="warning-message" role="note"><span><b>Saldo menipis.</b> Saldo di bawah {rupiah(balance.lowBalanceThreshold)}; kampanye berhenti tayang saat saldo habis. Isi saldo agar penayangan tidak terputus.</span></p>}
  </>;
}
