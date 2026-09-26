"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { SponsorBalanceDto, TopUpDto } from "@/lib/frontend/ad-types";
import { api } from "@/lib/frontend/api";
import {
  QUICK_AMOUNTS, amountDigits, demoTopUp, formatAmountInput, proofProblem, topUpBlockReason, topUpFailure, topUpTextFields, transferDateRange, validateTopUp,
  type FieldErrors, type TopUpField, type TopUpForm,
} from "@/lib/frontend/campaign-rules";
import { wibToday } from "@/lib/frontend/demo-ads";
import { number, rupiah } from "@/lib/frontend/format";
import { useHub } from "../context";
import { Icon } from "../icon";
import { AccountCard } from "./balance-account";
import { ProofField } from "./balance-proof";
import { failureOf, type SponsorStatus } from "./campaign-data";
import { FieldError } from "./campaign-fields";

/**
 * Formulir top-up: rekening tujuan, nominal (format rupiah + chip cepat), tanggal transfer (30 hari
 * terakhir), pengirim, catatan, dan foto bukti. Multipart persis kontrak; demo menambah baris lokal.
 */
interface FormState extends Omit<TopUpForm, "file"> { readonly file: File | null }
const FIELDS: readonly TopUpField[] = ["amount", "transferDate", "senderName", "senderBank", "note", "file"];
const DEMO_PROOF = "demo:ads/bukti-transfer.svg";
const blank = (today: string): FormState => ({ amount: "", transferDate: today, senderName: "", senderBank: "", note: "", file: null });

async function sendTopUp(form: FormState): Promise<TopUpDto> {
  const body = new FormData();
  for (const [key, value] of topUpTextFields(form)) body.set(key, value);
  if (form.file) body.set("file", form.file);
  return (await api("/sponsor/topups", { method: "POST", body })).data as TopUpDto;
}

interface PanelProps {
  readonly balance: SponsorBalanceDto;
  readonly sponsorStatus: SponsorStatus | null;
  readonly onSubmitted: (topUp: TopUpDto, proofUrl: string | null) => void;
}

function useTopUpForm({ balance, onSubmitted }: PanelProps) {
  const { demo, toast, me } = useHub();
  const [form, setForm] = useState<FormState>(() => blank(wibToday()));
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors<TopUpField>>({});
  const [general, setGeneral] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (!demo && proofUrl) URL.revokeObjectURL(proofUrl); }, [demo, proofUrl]);
  const set = (patch: Partial<FormState>) => { setForm(f => ({ ...f, ...patch })); setErrors(e => Object.fromEntries(Object.entries(e).filter(([k]) => !(k in patch)))); };
  const pick = (file: File) => {
    const problem = proofProblem(file);
    if (problem) { setErrors(e => ({ ...e, file: problem })); return; }
    set({ file }); setProofUrl(URL.createObjectURL(file));
  };
  const clearProof = () => { set({ file: null }); setProofUrl(null); };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validateTopUp(form, { min: balance.minTopUpAmount, today: wibToday() });
    setErrors(found); setGeneral("");
    const first = FIELDS.find(f => found[f]);
    if (first) { document.getElementById(`topup-${first}`)?.focus(); return; }
    setBusy(true);
    try {
      const topUp = demo ? demoTopUp(form, { id: `demo-topup-${Date.now()}`, sponsorId: me.sponsor?.id ?? "demo-sponsor", proofFileId: DEMO_PROOF, nowIso: new Date().toISOString() }) : await sendTopUp(form);
      onSubmitted(topUp, demo ? proofUrl : null);
      setForm(blank(wibToday())); setProofUrl(null);
      toast(demo ? "Mode demo: top-up diajukan (simulasi)." : "Bukti top-up terkirim. Saldo bertambah setelah diverifikasi admin.");
    } catch (e) {
      const failure = topUpFailure(failureOf(e));
      if (failure.field === "general") setGeneral(failure.message);
      else { setErrors({ [failure.field]: failure.message }); document.getElementById(`topup-${failure.field}`)?.focus(); }
    } finally { setBusy(false); }
  }
  return { form, proofUrl, errors, general, busy, set, pick, clearProof, submit };
}

export function TopUpPanel(props: PanelProps) {
  const { balance, sponsorStatus } = props;
  const { form, proofUrl, errors, general, busy, set, pick, clearProof, submit } = useTopUpForm(props);
  const block = topUpBlockReason({ account: balance.topUpAccount, sponsorStatus, pending: balance.pendingTopUps });
  return <section className="panel topup-panel" aria-labelledby="topup-title">
    <div className="panel-heading"><div><h2 id="topup-title">Isi saldo</h2><p>Transfer ke rekening di bawah, lalu kirim buktinya. Saldo bertambah setelah diverifikasi admin.</p></div></div>
    <AccountCard account={balance.topUpAccount} />
    {block && balance.topUpAccount && <p className="info-message" role="note">{block}</p>}
    <form noValidate onSubmit={e => void submit(e)}>
      <fieldset className="topup-fields form-grid" disabled={Boolean(block) || busy}>
        <legend className="sr-only">Data transfer</legend>
        <AmountField value={form.amount} min={balance.minTopUpAmount} cpc={balance.defaultCpcAmount} error={errors.amount} onChange={amount => set({ amount })} />
        <TextField id="transferDate" label="Tanggal transfer" type="date" value={form.transferDate} error={errors.transferDate} onChange={transferDate => set({ transferDate })} range={transferDateRange(wibToday())} />
        <TextField id="senderBank" label="Bank pengirim" value={form.senderBank} error={errors.senderBank} placeholder="mis. BCA" onChange={senderBank => set({ senderBank })} />
        <TextField id="senderName" label="Nama pemilik rekening pengirim" value={form.senderName} error={errors.senderName} placeholder="Sesuai rekening bank" onChange={senderName => set({ senderName })} full />
        <NoteField value={form.note} error={errors.note} onChange={note => set({ note })} />
        <ProofField file={form.file} previewUrl={proofUrl} error={errors.file} onPick={pick} onClear={clearProof} />
        {general && <p className="error-message full-width" role="alert">{general}</p>}
        <button type="submit" className="button primary block full-width" disabled={busy}><Icon name="upload" size={19} />{busy ? "Mengirim…" : "Kirim bukti top-up"}</button>
      </fieldset>
    </form>
  </section>;
}

function AmountField({ value, min, cpc, error, onChange }: { value: string; min: number; cpc: number; error?: string; onChange: (digits: string) => void }) {
  const id = "topup-amount";
  const clicks = value && cpc > 0 ? Math.floor(Number(value) / cpc) : 0;
  return <div className="field full-width">
    <label htmlFor={id}>Nominal transfer</label>
    <div className="money-input"><span aria-hidden="true">Rp</span>
      <input id={id} inputMode="numeric" autoComplete="off" placeholder="0" value={formatAmountInput(value)} aria-invalid={Boolean(error)} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`} onChange={e => onChange(amountDigits(e.target.value))} />
    </div>
    <div className="quick-amounts" role="group" aria-label="Nominal cepat">
      {QUICK_AMOUNTS.filter(q => q.value >= min).map(q => <button key={q.value} type="button" className="mini-chip" aria-pressed={value === String(q.value)} onClick={() => onChange(String(q.value))}>{q.label}</button>)}
    </div>
    <small className="field-hint" id={`${id}-hint`}>Minimal {rupiah(min)}{clicks > 0 ? ` · ≈ ${number(clicks)} klik` : ""}. Transfer persis sebesar nominal ini agar cepat diverifikasi.</small>
    <FieldError id={id} error={error} />
  </div>;
}

interface TextProps { id: TopUpField; label: string; value: string; error?: string; type?: string; placeholder?: string; full?: boolean; range?: { earliest: string; latest: string }; onChange: (value: string) => void }

function TextField({ id, label, value, error, type = "text", placeholder, full, range, onChange }: TextProps) {
  const inputId = `topup-${id}`;
  return <div className={`field${full ? " full-width" : ""}`}>
    <label htmlFor={inputId}>{label}</label>
    <input id={inputId} type={type} value={value} placeholder={placeholder} min={range?.earliest} max={range?.latest} autoComplete="off" aria-invalid={Boolean(error)} aria-describedby={error ? `${inputId}-error` : undefined} onChange={e => onChange(e.target.value)} />
    <FieldError id={inputId} error={error} />
  </div>;
}

function NoteField({ value, error, onChange }: { value: string; error?: string; onChange: (value: string) => void }) {
  return <div className="field full-width">
    <label htmlFor="topup-note">Catatan <span className="muted">(opsional)</span></label>
    <textarea id="topup-note" rows={2} value={value} maxLength={255} placeholder="mis. Top-up untuk kampanye Oktober" aria-invalid={Boolean(error)} aria-describedby={error ? "topup-note-error" : undefined} onChange={e => onChange(e.target.value)} />
    <FieldError id="topup-note" error={error} />
  </div>;
}
