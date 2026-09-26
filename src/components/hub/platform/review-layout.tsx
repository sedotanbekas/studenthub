"use client";
import { useEffect, useRef, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { SEARCH_MAX, shownOfTotal } from "@/lib/frontend/review-rules";
import { Icon } from "../icon";
import { useModalDialog } from "./review-dialog-focus";
import type { ReviewQueue } from "./review-hooks";

/**
 * Kerangka halaman peninjauan: antrean di kiri + detail di kanan (layar lebar), atau antrean penuh +
 * detail sebagai sheet bawah (HP/tablet). Dipakai moderasi iklan & verifikasi top-up.
 */

export interface ReviewLayoutProps {
  readonly wide: boolean;
  readonly list: ReactNode;
  /** Detail item terpilih; null = belum ada yang dipilih. */
  readonly detail: ReactNode | null;
  /** Id item yang detailnya tampil (tujuan fokus saat sheet ditutup). */
  readonly detailId: string | null;
  readonly detailLabel: string;
  readonly placeholder: ReactNode;
  readonly onCloseSheet: () => void;
}

export function ReviewLayout({ wide, list, detail, detailId, detailLabel, placeholder, onCloseSheet }: ReviewLayoutProps) {
  return <div className={`review-layout${wide ? " split" : ""}`}>
    <section className="panel review-list-panel" aria-label="Antrean" tabIndex={-1}>{list}</section>
    {wide
      ? <section className="panel review-detail-panel" aria-label={detailLabel}>{detail ?? placeholder}</section>
      : detail && <ReviewSheet label={detailLabel} itemId={detailId} onClose={onCloseSheet}>{detail}</ReviewSheet>}
  </div>;
}

/**
 * Sheet bawah (dialog modal): Escape, tombol tutup, atau ketuk latar menutupnya. Seleksi teks yang
 * dimulai di dalam sheet lalu diseret ke latar tidak menutupnya.
 */
function ReviewSheet({ label, itemId, onClose, children }: { label: string; itemId: string | null; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  useModalDialog(dialog, itemId);
  const onPointerDown = (event: PointerEvent<HTMLDialogElement>) => { pressedBackdrop.current = event.target === event.currentTarget; };
  const onBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    const fromBackdrop = pressedBackdrop.current;
    pressedBackdrop.current = false;
    if (fromBackdrop && event.target === event.currentTarget) onClose();
  };
  // Browser dapat menutup dialog tanpa event cancel (Escape berulang); samakan state induk.
  const onNativeClose = () => { if (dialog.current && !dialog.current.open) onClose(); };
  return <dialog ref={dialog} className="action-dialog review-sheet" aria-label={label} onCancel={e => { e.preventDefault(); onClose(); }} onClose={onNativeClose} onPointerDown={onPointerDown} onClick={onBackdrop}>
    <div className="review-sheet-bar">
      <span className="review-grabber" aria-hidden="true" />
      <span className="eyebrow">{label}</span>
      <button type="button" className="icon-button" aria-label="Tutup detail" onClick={onClose}><Icon name="close" /></button>
    </div>
    {children}
  </dialog>;
}

export interface QueueListProps<T extends { readonly id: string }> {
  readonly label: string;
  readonly summary: ReactNode;
  readonly queue: ReviewQueue<T>;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly empty: { readonly title: string; readonly text: string };
  readonly renderItem: (item: T) => ReactNode;
  /** Kontrol di atas daftar (mis. pencarian); tetap terpasang di semua keadaan agar fokus tidak hilang. */
  readonly header?: ReactNode;
}

/** Daftar antrean: setiap item tombol besar (>= 64px) yang membuka detail. */
export function QueueList<T extends { readonly id: string }>(props: QueueListProps<T>) {
  return <>{props.header}<QueueBody {...props} /></>;
}

function QueueBody<T extends { readonly id: string }>({ label, summary, queue, selectedId, onSelect, empty, renderItem }: QueueListProps<T>) {
  const list = useRef<HTMLUListElement>(null);
  const focusFrom = useRef<number | null>(null);
  const { items, loading, error, loadingMore } = queue;
  // Setelah "Muat lebih banyak": fokus pindah ke item pertama yang baru dimuat (tombolnya bisa hilang).
  useEffect(() => {
    const from = focusFrom.current;
    if (from === null || loadingMore) return;
    focusFrom.current = null;
    if (items.length > from) list.current?.querySelectorAll<HTMLElement>(".review-item")[from]?.focus();
  }, [items.length, loadingMore]);
  if (error) return <div className="error-message" role="alert">{error}<button type="button" className="text-button" onClick={queue.reload}>Coba lagi</button></div>;
  if (loading && items.length === 0) return <div role="status" aria-label="Memuat antrean">{[1, 2, 3].map(i => <div className="skeleton review-skeleton" key={i} />)}</div>;
  if (items.length === 0) return <ReviewEmpty icon="check" title={empty.title} text={empty.text} />;
  const more = () => { focusFrom.current = items.length; queue.loadMore(); };
  return <>
    <p className="review-summary">{summary}</p>
    <ul ref={list} className="review-queue" aria-label={label}>
      {items.map(item => <li key={item.id}>
        <button type="button" className="review-item" data-review-id={item.id} aria-current={item.id === selectedId ? "true" : undefined} onClick={() => onSelect(item.id)}>
          {renderItem(item)}
          <span className="review-item-go" aria-hidden="true"><Icon name="chevron" size={18} /></span>
        </button>
      </li>)}
    </ul>
    <QueueMore queue={queue} onMore={more} />
  </>;
}

/** "Menampilkan N dari total" + tombol halaman berikutnya. */
function QueueMore<T>({ queue, onMore }: { queue: ReviewQueue<T>; onMore: () => void }) {
  const text = shownOfTotal(queue.items.length, queue.total);
  if (!text && !queue.hasMore) return null;
  return <div className="review-more">
    {text && <p>{text}</p>}
    {queue.moreError && <p className="field-error" role="alert">{queue.moreError}</p>}
    {queue.hasMore && <button type="button" className="button secondary" disabled={queue.loadingMore || queue.loading} onClick={onMore}>
      {queue.loadingMore ? "Memuat…" : "Muat lebih banyak"}
    </button>}
  </div>;
}

/** Kolom pencarian antrean (tab non-antrean). */
export function QueueSearchField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="table-search review-search">
    <Icon name="search" size={18} />
    <span className="sr-only">{label}</span>
    <input type="search" value={value} maxLength={SEARCH_MAX} placeholder={`${label}…`} autoComplete="off" onChange={e => onChange(e.target.value)} />
  </label>;
}

export function ReviewEmpty({ icon, title, text }: { icon: string; title: string; text: string }) {
  return <div className="empty-state review-empty"><span className="review-empty-icon" aria-hidden="true"><Icon name={icon} size={26} /></span><h2>{title}</h2><p>{text}</p></div>;
}

/** Satu baris fakta di detail (label kecil + isi). */
export function Fact({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div className={`review-fact${wide ? " wide" : ""}`}><dt>{label}</dt><dd>{children}</dd></div>;
}
