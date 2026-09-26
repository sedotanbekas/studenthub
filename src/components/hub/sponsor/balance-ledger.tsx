"use client";
import type { LedgerEntryDto } from "@/lib/frontend/ad-types";
import { LEDGER_LABELS, groupByDay, signedRupiah, wibTime } from "@/lib/frontend/campaign-rules";
import { wibToday } from "@/lib/frontend/demo-ads";
import { rupiah } from "@/lib/frontend/format";
import { Icon } from "../icon";
import { useLedger, type LedgerType } from "./balance-data";

/** Mutasi saldo per hari (WIB): jenis, nominal bertanda (+/−), saldo setelahnya, waktu, dan keterangan. */
const TYPES: readonly { value: LedgerType; label: string }[] = [
  { value: "ALL", label: "Semua" }, { value: "TOPUP", label: "Top-up" }, { value: "CLICK_CHARGE", label: "Potongan klik" }, { value: "ADJUSTMENT", label: "Penyesuaian" },
];
const ICONS: Readonly<Record<LedgerEntryDto["type"], string>> = { TOPUP: "plus", CLICK_CHARGE: "megaphone", ADJUSTMENT: "settings" };

function detailOf(entry: LedgerEntryDto, adTitles: Readonly<Record<string, string>>): string {
  if (entry.note) return entry.note;
  if (entry.type === "CLICK_CHARGE") return entry.adId && adTitles[entry.adId] ? `Klik pada “${adTitles[entry.adId]}”` : "Klik sah pada kampanye";
  return entry.type === "TOPUP" ? "Top-up disetujui admin" : "";
}

export function LedgerPanel({ adTitles }: { adTitles: Readonly<Record<string, string>> }) {
  const ledger = useLedger();
  const groups = groupByDay(ledger.rows, wibToday());
  return <section className="panel ledger-panel" aria-labelledby="ledger-title">
    <div className="panel-heading"><div><h2 id="ledger-title">Mutasi saldo</h2><p>Setiap perubahan saldo tercatat berurutan beserta saldo setelahnya.</p></div></div>
    <div className="ledger-types" role="group" aria-label="Jenis mutasi">{TYPES.map(t => <button key={t.value} type="button" className="mini-chip" aria-pressed={ledger.type === t.value} onClick={() => ledger.setType(t.value)}>{t.label}</button>)}</div>
    {ledger.error && <div className="error-message" role="alert">{ledger.error}<button type="button" className="text-button" onClick={ledger.retry}>Coba lagi</button></div>}
    {ledger.rows.length === 0 && ledger.loading && <div aria-busy="true"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>}
    {ledger.rows.length === 0 && !ledger.loading && !ledger.error && <p className="muted">Belum ada mutasi untuk jenis ini.</p>}
    {groups.map(group => <div key={group.date} className="ledger-day">
      <h3>{group.label}</h3>
      <ul className="ledger-list">{group.entries.map(entry => <LedgerRow key={entry.id} entry={entry} detail={detailOf(entry, adTitles)} />)}</ul>
    </div>)}
    {ledger.hasMore && <button type="button" className="button secondary" disabled={ledger.loading} onClick={ledger.more}>{ledger.loading ? "Memuat…" : "Muat lebih banyak"}</button>}
  </section>;
}

function LedgerRow({ entry, detail }: { entry: LedgerEntryDto; detail: string }) {
  return <li className={`ledger-row type-${entry.type.toLowerCase()}`}>
    <span className="ledger-icon" aria-hidden="true"><Icon name={ICONS[entry.type]} size={18} /></span>
    <span className="ledger-main">
      <strong>{LEDGER_LABELS[entry.type] ?? entry.type}</strong>
      <small>{wibTime(entry.createdAt)} WIB{detail ? ` · ${detail}` : ""}</small>
    </span>
    <span className="ledger-amount">
      <b className={entry.amount > 0 ? "plus" : "minus"}>{signedRupiah(entry.amount)}</b>
      <small>Saldo {rupiah(entry.balanceAfter)}</small>
    </span>
  </li>;
}
