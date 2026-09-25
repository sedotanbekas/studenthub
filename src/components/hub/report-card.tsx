"use client";
import { display } from "@/lib/frontend/format";
import type { OwnReportCardDetailDto, ReportCardDetailDto } from "@/lib/report-cards/schemas";
import type { Row } from "@/lib/frontend/types";
import { useHub } from "./context";
import { Icon } from "./icon";

/**
 * Tampilan dokumen rapor (layar & cetak A4). Format awal = ASUMSI struktur umum Kurikulum Merdeka:
 * kop sekolah, identitas, nilai akhir + capaian kompetensi per mapel, ketidakhadiran, dan
 * penandatangan. Kop/penandatangan/bagian tambahan per sekolah menyusul setelah contoh rapor
 * sekolah klien terkumpul. Warna mengikuti tema sekolah.
 */
/** Detail rapor milik siswa (GET /student/report-cards/{id}) atau detail admin (GET /school/report-cards/{id}). */
export type ReportCardData = OwnReportCardDetailDto | ReportCardDetailDto;

/** Bagian yang berbeda antara bentuk siswa & admin. */
function facts(card: ReportCardData) {
  return "termLabel" in card
    ? { student: null, term: card.termLabel, absence: card.attendance, draft: false }
    : { student: card.student, term: card.term.label, absence: card.attendanceSummary, draft: card.status === "DRAFT" };
}

export function isReportCardDetail(value: unknown): value is ReportCardData {
  return typeof value === "object" && value !== null && Array.isArray((value as Row).grades) && ("termLabel" in value || "term" in value);
}

const score = (value: number | null | undefined) => value === null || value === undefined ? "—" : new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(value);

export function ReportCardDocument({ card }: { card: ReportCardData }) {
  const { me } = useHub();
  const { student, term, absence, draft } = facts(card);
  const name = student?.name ?? me.user.name;
  return <article className={`report-doc ${draft ? "is-draft" : ""}`} aria-label={`Rapor ${name}`}>
    <header className="report-kop"><span className="brand-mark" aria-hidden="true"><Icon name="book" size={24} /></span><div><strong>{me.school?.name ?? "Sekolah"}</strong><span>Laporan Hasil Belajar Peserta Didik</span></div>{draft && <b className="report-draft">DRAF</b>}</header>
    <dl className="report-identity">
      <div><dt>Nama peserta didik</dt><dd>{name}</dd></div>
      {student?.nis && <div><dt>NIS</dt><dd>{student.nis}</dd></div>}
      <div><dt>Kelas</dt><dd>{card.className}</dd></div>
      <div><dt>Semester</dt><dd>{term}</dd></div>
    </dl>
    <div className="table-scroll"><table className="report-grades"><thead><tr><th scope="col">No</th><th scope="col">Mata pelajaran</th><th scope="col">KKM</th><th scope="col">Nilai akhir</th><th scope="col">Predikat</th><th scope="col">Capaian kompetensi</th></tr></thead>
      <tbody>{card.grades.map((g, i) => <tr key={`${g.subjectName}-${i}`}><td>{i + 1}</td><td>{g.subjectName}</td><td>{g.kkm}</td><td className={g.score < g.kkm ? "below-kkm" : ""}>{g.score}</td><td>{g.predicate}</td><td>{g.description ?? "—"}</td></tr>)}</tbody>
      <tfoot><tr><th scope="row" colSpan={3}>Rata-rata nilai</th><td>{score(card.average)}</td><td colSpan={2} /></tr></tfoot></table></div>
    <div className="report-bottom">
      <table className="report-absence"><caption>Ketidakhadiran</caption><tbody><tr><th scope="row">Sakit</th><td>{absence.sick} hari</td></tr><tr><th scope="row">Izin</th><td>{absence.permit} hari</td></tr><tr><th scope="row">Tanpa keterangan</th><td>{absence.absent} hari</td></tr></tbody></table>
      <div className="report-signs"><p>{card.publishedAt ? `Diterbitkan ${display(card.publishedAt)}` : "Belum diterbitkan"}</p><div><span>Orang tua / wali</span><i /></div><div><span>Wali kelas</span><i /></div><div><span>Kepala sekolah</span><i /></div></div>
    </div>
  </article>;
}
