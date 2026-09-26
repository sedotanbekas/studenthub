"use client";
import { useEffect, useRef, useState } from "react";
import type { RecordDetailDto } from "@/lib/attendance/monitor-schemas";
import { display, initials } from "@/lib/frontend/format";
import { useHub } from "../context";
import { Icon } from "../icon";
import { AttPill } from "./att-pill";
import { formatAccuracy, formatDistance } from "./monitor-rules";
import { useRecordDetail } from "./use-monitor-data";

/** Dialog detail satu catatan kehadiran (selfie, lokasi, anomali, percobaan ditolak). */

const SOURCE_LABEL: Record<RecordDetailDto["source"], string> = { CHECKIN: "Absen mandiri (lokasi & selfie)", LEAVE: "Pengajuan izin/sakit", AUTO_ALPHA: "Alpa otomatis", ADMIN: "Dicatat admin" };
const SEVERITY_LABEL: Record<RecordDetailDto["flags"][number]["severity"], string> = { LOW: "Info", MEDIUM: "Sedang", HIGH: "Tinggi" };

export interface DetailTarget { readonly id: string; readonly name: string }

export function RecordDetailDialog({ target, date, onClose }: { target: DetailTarget; date: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [retry, setRetry] = useState(0);
  const { data, error } = useRecordDetail(target.id, date, retry);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="action-dialog detail-dialog monitor-detail" aria-labelledby="monitor-detail-title" onCancel={e => { e.preventDefault(); onClose(); }}>
    <div className="dialog-heading"><div><span className="eyebrow">Detail kehadiran</span><h2 id="monitor-detail-title">{target.name}</h2>{data && <small className="muted">{[data.className ?? "Tanpa kelas", `NIS ${data.student.nis}`, display(data.date)].join(" · ")}</small>}</div><button className="icon-button" aria-label="Tutup detail" onClick={onClose}><Icon name="close" /></button></div>
    <div className="dialog-body">
      {error ? <div className="error-message" role="alert">{error}<button className="text-button" onClick={() => setRetry(v => v + 1)}>Coba lagi</button></div>
        : data ? <DetailBody data={data} />
        : <div role="status" aria-label="Memuat detail">{[1, 2, 3, 4].map(i => <div className="skeleton" key={i} />)}</div>}
    </div>
    <div className="dialog-footer"><button className="button primary small-button" onClick={onClose}>Selesai</button></div>
  </dialog>;
}

function DetailBody({ data }: { data: RecordDetailDto }) {
  const mocked = data.isMocked === null ? "—" : data.isMocked ? "Terdeteksi" : "Tidak terdeteksi";
  const coordinate = data.latitude !== null && data.longitude !== null ? `${data.latitude.toFixed(5)}, ${data.longitude.toFixed(5)}` : "—";
  return <div className="monitor-detail-grid">
    <Selfie data={data} />
    <div className="monitor-detail-main">
      <div className="monitor-detail-status"><AttPill status={data.status} />{data.lateMinutes ? <span className="muted">Terlambat {data.lateMinutes} menit</span> : null}</div>
      <dl className="monitor-facts">
        <Fact label="Jam masuk" value={data.checkInTimeLocal ?? "—"} />
        <Fact label="Sumber" value={SOURCE_LABEL[data.source]} />
        <Fact label="Jarak ke sekolah" value={formatDistance(data.distanceM)} />
        <Fact label="Akurasi GPS" value={formatAccuracy(data.accuracyM)} />
        <Fact label="Lokasi palsu" value={mocked} />
        <Fact label="Koordinat" value={coordinate} />
      </dl>
      {data.flags.length > 0 && <section aria-labelledby="monitor-flags-title"><h3 id="monitor-flags-title" className="monitor-subhead">Catatan pemeriksaan</h3><ul className="monitor-flags">{data.flags.map(f => <li key={f.code} className={`sev-${f.severity.toLowerCase()}`}><span className="sev">{SEVERITY_LABEL[f.severity]}</span>{f.label}</li>)}</ul></section>}
      {data.note && <p className="monitor-note"><strong>Catatan:</strong> {data.note}</p>}
      {data.rejectionsSameDay.length > 0 && <section aria-labelledby="monitor-rejects-title"><h3 id="monitor-rejects-title" className="monitor-subhead">Percobaan ditolak hari itu</h3><ul className="monitor-rejects">{data.rejectionsSameDay.map(r => <li key={r.id}><strong>{r.timeLocal}</strong> · {r.reasonLabel} · {formatDistance(r.distanceM)}</li>)}</ul></section>}
    </div>
  </div>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function Selfie({ data }: { data: RecordDetailDto }) {
  const { demo } = useHub();
  if (!data.selfie) return <figure className="monitor-selfie is-empty"><Icon name="camera" size={28} /><figcaption>Tanpa foto selfie</figcaption></figure>;
  if (demo) return <figure className="monitor-selfie is-placeholder"><span className="monitor-selfie-initials" aria-hidden="true">{initials(data.student.name)}</span><figcaption>Foto contoh — selfie asli tampil di sini</figcaption></figure>;
  if (data.selfie.purged) return <figure className="monitor-selfie is-empty"><Icon name="image" size={28} /><figcaption>Foto sudah dihapus sesuai masa simpan</figcaption></figure>;
  return <figure className="monitor-selfie">
    {/* eslint-disable-next-line @next/next/no-img-element -- berkas privat lewat proxy sesi /api/web/files, tidak bisa dioptimasi next/image */}
    <img src={`/api/web/files/${encodeURIComponent(data.selfie.fileId)}`} alt={`Selfie ${data.student.name} saat absen`} loading="lazy" />
    <figcaption>Selfie saat absen</figcaption>
  </figure>;
}
