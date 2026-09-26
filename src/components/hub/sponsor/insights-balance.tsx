"use client";
import type { SponsorBalanceDto, SponsorDto } from "@/lib/frontend/ad-types";
import { number, rupiah } from "@/lib/frontend/format";
import { accountNotice, balanceAlert, runwayLabel } from "@/lib/frontend/sponsor-insights-rules";
import { HubLink } from "../hub-link";
import { Icon } from "../icon";

/** Pemberitahuan status akun sponsor (sedang ditinjau / ditangguhkan); akun aktif -> tidak tampil. */
export function AccountNoticeBanner({ profile }: { profile: SponsorDto | null }) {
  const notice = profile ? accountNotice(profile.status, profile.statusReason) : null;
  if (!notice) return null;
  return <div className={notice.tone === "info" ? "info-message account-notice" : "warning-message account-notice"} role="status">
    <Icon name={notice.tone === "info" ? "history" : "shield"} size={20} />
    <span><strong>{notice.title}</strong> — {notice.text}</span>
  </div>;
}

/**
 * Kartu saldo bergradien (warna banner sekolah): saldo, perkiraan sisa klik, catatan halus (saldo
 * menipis, top-up menunggu verifikasi, perkiraan umur saldo), dan dua aksi utama.
 */
export function BalanceHero({ balance, weekSpend }: { balance: SponsorBalanceDto | null; weekSpend: number | null }) {
  return <section className="sponsor-hero" aria-labelledby="sponsor-hero-title">
    <div className="hero-main">
      <h2 id="sponsor-hero-title" className="hero-kicker"><Icon name="wallet" size={16} />Saldo iklan</h2>
      {balance
        ? <><strong className="hero-value">{rupiah(balance.balance)}</strong><p className="hero-sub">± {number(balance.estimatedClicksRemaining)} klik lagi · {rupiah(balance.defaultCpcAmount)} per klik</p></>
        : <><span className="hero-skeleton wide" aria-hidden="true" /><span className="hero-skeleton" aria-hidden="true" /><span className="sr-only">Memuat saldo…</span></>}
    </div>
    <div className="hero-actions">
      <HubLink href="/hub/balance" className="button hero-button"><Icon name="plus" size={18} />Isi saldo</HubLink>
      <HubLink href="/hub/campaigns?baru=1" className="button hero-button ghost"><Icon name="megaphone" size={18} />Buat kampanye</HubLink>
    </div>
    {balance && <HeroNotes balance={balance} weekSpend={weekSpend} />}
  </section>;
}

function HeroNotes({ balance, weekSpend }: { balance: SponsorBalanceDto; weekSpend: number | null }) {
  const alert = balanceAlert(balance);
  const runway = weekSpend === null ? null : runwayLabel(balance.balance, weekSpend, 7);
  if (!alert && !balance.pendingTopUps && !runway) return null;
  return <ul className="hero-notes">
    {alert && <li className="hero-note alert"><Icon name="bell" size={16} />{alert === "empty" ? "Saldo habis — iklan berhenti tayang sampai saldo diisi." : "Saldo mulai menipis — isi ulang agar kampanye tetap tayang."}</li>}
    {balance.pendingTopUps > 0 && <li className="hero-note"><Icon name="history" size={16} />{number(balance.pendingTopUps)} top-up menunggu verifikasi</li>}
    {runway && <li className="hero-note"><Icon name="calendar" size={16} />{runway}</li>}
  </ul>;
}
