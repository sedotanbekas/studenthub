"use client";
import type { ChecklistStep } from "@/lib/frontend/onboarding-rules";
import { HubLink } from "./hub-link";
import { Icon } from "./icon";

/**
 * Kartu persiapan di Beranda (sekolah baru, sponsor baru): langkah berurutan dengan status, satu kalimat kenapa
 * langkah itu perlu, dan tombol yang langsung membuka tempatnya. Disembunyikan pemanggil bila sudah selesai.
 */
const MARK: Readonly<Record<ChecklistStep["status"], string>> = { done: "✓", waiting: "…", todo: "", optional: "" };
const STATUS_TEXT: Readonly<Record<ChecklistStep["status"], string>> = { done: "selesai", waiting: "menunggu", todo: "belum", optional: "opsional" };

export function ChecklistCard({ eyebrow, title, intro, steps }: { eyebrow: string; title: string; intro: string; steps: readonly ChecklistStep[] }) {
  const done = steps.filter((step) => step.status === "done").length;
  return <section className="panel checklist-card" aria-labelledby={`checklist-${eyebrow}`}>
    <header className="wizard-top">
      <div><span className="eyebrow">{eyebrow}</span><h2 id={`checklist-${eyebrow}`}>{title}</h2><p>{intro}</p></div>
      <div className="wizard-progress" role="progressbar" aria-label="Kemajuan persiapan" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}><span style={{ width: `${(done / Math.max(steps.length, 1)) * 100}%` }} /></div>
    </header>
    <ol className="checklist-steps">{steps.map((step, i) => <li key={step.key} className={`checklist-step ${step.status}`}>
      <span className="step-mark" aria-hidden="true">{MARK[step.status] || i + 1}</span>
      <div className="checklist-text">
        <strong>{step.title}{step.status === "optional" && <em className="step-optional">Opsional</em>}<span className="sr-only"> ({STATUS_TEXT[step.status]})</span></strong>
        <small>{step.summary}</small>
        {step.status !== "done" && <p className="checklist-why">{step.why}</p>}
      </div>
      {step.href && step.status !== "done" && <HubLink href={step.href} className="button secondary small-button">{step.cta}<Icon name="arrow" size={15} /></HubLink>}
    </li>)}</ol>
  </section>;
}
