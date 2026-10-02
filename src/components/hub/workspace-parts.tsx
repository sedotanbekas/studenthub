"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { downloadApiFile, scoped } from "@/lib/frontend/api";
import type { Operation } from "@/lib/frontend/types";
import { ACTION_LABELS, splitActions, VIEW_LABELS, type ViewNote } from "@/lib/frontend/workspace-rules";
import { actionLabel, actionTitle } from "./action-dialog";
import { useHub } from "./context";
import { Icon } from "./icon";

/**
 * Bagian halaman generik: tab tampilan (bukan dropdown "Pilih tampilan"), tombol aksi halaman yang menyebut
 * objeknya, dan menu "Lainnya" berisi aksi jarang dipakai beserta satu kalimat penjelasan.
 */
export const viewLabel = (op: Operation): string => VIEW_LABELS[op.id] ?? actionTitle(op);

export function ViewTabs({ views, current, onChange }: { views: readonly Operation[]; current: Operation | undefined; onChange: (op: Operation) => void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = views.findIndex((op) => op.id === current?.id);
    const next = event.key === "Home" ? 0 : event.key === "End" ? views.length - 1 : (index + (event.key === "ArrowRight" ? 1 : views.length - 1)) % views.length;
    const target = views[next];
    if (!target) return;
    onChange(target);
    const tab = document.getElementById(`view-tab-${target.id}`);
    tab?.focus();
    tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  return <div className="monitor-tabs view-tabs" role="tablist" aria-label="Tampilan data" onKeyDown={onKeyDown}>
    {views.map((op) => <button key={op.id} type="button" role="tab" id={`view-tab-${op.id}`} className="monitor-tab" aria-selected={op.id === current?.id} aria-controls={op.id === current?.id ? "view-panel" : undefined} tabIndex={op.id === current?.id ? 0 : -1} onClick={() => onChange(op)}>{viewLabel(op)}</button>)}
  </div>;
}

/** Templat impor diunduh langsung (bukan dialog); aksi lain membuka dialog formulir. */
function useRunAction(onOpen: (op: Operation) => void): (op: Operation) => void {
  const { schoolId, toast } = useHub();
  return (op) => {
    if (!op.id.includes("Template")) { onOpen(op); return; }
    downloadApiFile(scoped(op.path, schoolId), "template-siswa.xlsx")
      .catch((e: unknown) => toast(e instanceof Error ? e.message : "Unduhan gagal."));
  };
}

interface PageActionsProps {
  readonly create: Operation | undefined;
  readonly secondary: readonly Operation[];
  readonly disabled: boolean;
  readonly onOpen: (op: Operation) => void;
}

export function PageActions({ create, secondary, disabled, onOpen }: PageActionsProps) {
  const run = useRunAction(onOpen);
  const { visible, overflow } = splitActions(secondary);
  return <div className="heading-actions">
    {create && <button type="button" className="button primary" disabled={disabled} onClick={() => onOpen(create)}><Icon name="plus" size={17} />{actionLabel(create)}</button>}
    {visible.map((op) => <button key={op.id} type="button" className="button secondary" disabled={disabled} title={ACTION_LABELS[op.id]?.hint} onClick={() => run(op)}>{op.id.includes("Template") && <Icon name="download" size={16} />}{actionLabel(op)}</button>)}
    {overflow.length > 0 && <ActionMenu actions={overflow} disabled={disabled} onSelect={run} />}
  </div>;
}

function ActionMenu({ actions, disabled, onSelect }: { actions: readonly Operation[]; disabled: boolean; onSelect: (op: Operation) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); root.current?.querySelector<HTMLButtonElement>(".action-menu-toggle")?.focus(); } };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  // Pola disclosure (bukan role="menu"): tombol + daftar tombol biasa; Tab berjalan wajar, fokus keluar = tutup.
  return <div className="action-menu" ref={root} onBlur={(event) => { if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <button type="button" className="button secondary action-menu-toggle" disabled={disabled} aria-expanded={open} aria-controls="action-menu-list" onClick={() => setOpen((value) => !value)}>Lainnya<Icon name="down" size={16} /></button>
    {open && <ul className="action-menu-list" id="action-menu-list" aria-label="Tindakan lainnya">{actions.map((op) => <li key={op.id}>
      <button type="button" onClick={() => { setOpen(false); onSelect(op); }}><strong>{actionLabel(op)}</strong>{ACTION_LABELS[op.id]?.hint && <small>{ACTION_LABELS[op.id]!.hint}</small>}</button>
    </li>)}</ul>}
  </div>;
}

/** Catatan kecil di bawah tabel (mis. atribusi sumber data yang diwajibkan lisensinya). */
export function ViewNoteLine({ note }: { note: ViewNote | undefined }) {
  if (!note) return null;
  return <p className="view-note">{note.text}{note.link && <> <a className="text-link" href={note.link.href} target="_blank" rel="noreferrer">{note.link.label}</a></>}</p>;
}
