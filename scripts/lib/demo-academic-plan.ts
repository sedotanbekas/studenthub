/**
 * Rencana murni rapor & pengumuman demo (tanpa I/O, diuji unit). Penulisan lewat service domain ada di
 * demo-academic.ts.
 */
import type { NotificationCategory } from "@prisma/client";
import { computePredicate } from "../../src/lib/report-cards/rules";
import { demoInvoiceOutcome } from "./demo-billing-plan";
import type { DemoSchoolSpec } from "./demo-data";

/** Rapor Semester Ganjil diterbitkan untuk kelas pertama tiap sekolah demo (VII-A / X-1). */
export const DEMO_REPORT_CLASS_INDEX = 0;
const SCORE_BASE = 70;
const SCORE_SPREAD = 29;

/** Nilai deterministik 70..98 per siswa (urutan spesifikasi) & mapel (urutan pemetaan kelas). */
export function demoScore(studentIndex: number, subjectIndex: number): number {
  return SCORE_BASE + ((studentIndex * 7 + subjectIndex * 11) % SCORE_SPREAD);
}

const DESCRIPTION_BY_PREDICATE = {
  A: "Sangat baik: menguasai seluruh kompetensi dan mampu menerapkannya secara mandiri.",
  B: "Baik: menguasai sebagian besar kompetensi; tingkatkan latihan soal penerapan.",
  C: "Cukup: mencapai KKM; perlu penguatan pada beberapa kompetensi dasar.",
  D: "Perlu bimbingan: belum mencapai KKM, dijadwalkan remedial bersama guru mapel.",
} as const;

export function demoGradeDescription(score: number, kkm: number): string {
  return DESCRIPTION_BY_PREDICATE[computePredicate(score, kkm)];
}

export type DemoAnnouncementAudience = "ALL" | "CLASSES" | "STUDENTS";

export interface DemoAnnouncementPlan {
  readonly title: string;
  readonly category: Exclude<NotificationCategory, "SYSTEM">;
  readonly body: string;
  readonly audience: DemoAnnouncementAudience;
  /** audience CLASSES: nama kelas demo. */
  readonly classNames: readonly string[];
  /** audience STUDENTS: urutan siswa di spesifikasi demo. */
  readonly studentIndexes: readonly number[];
}

/** Siswa dengan tagihan September BELUM BAYAR (3 pertama) -> penerima pengingat SPP. */
const unpaidSeptember = (spec: DemoSchoolSpec): number[] =>
  spec.students.map((_, i) => i).filter((i) => demoInvoiceOutcome(i, 2) === "UNPAID").slice(0, 3);

/** Tiga pengumuman terbit per sekolah: semua siswa, satu kelas, dan siswa tertentu. Judul = kunci idempoten. */
export function demoAnnouncementPlans(spec: DemoSchoolSpec): DemoAnnouncementPlan[] {
  const className = spec.classes[DEMO_REPORT_CLASS_INDEX]?.name ?? "";
  return [
    {
      title: "Jadwal Penilaian Tengah Semester Ganjil 2026/2027",
      category: "ACADEMIC",
      body: "PTS Ganjil dilaksanakan 28 September - 3 Oktober 2026. Siswa hadir pukul 07.00 berseragam lengkap dan membawa kartu ujian. (data demo)",
      audience: "ALL",
      classNames: [],
      studentIndexes: [],
    },
    {
      title: `Kunjungan Edukasi Kelas ${className}`,
      category: "EVENT",
      body: `Kelas ${className} mengikuti kunjungan edukasi ke museum kota pada Jumat, 9 Oktober 2026. Formulir izin orang tua dikumpulkan paling lambat 5 Oktober. (data demo)`,
      audience: "CLASSES",
      classNames: [className],
      studentIndexes: [],
    },
    {
      title: "Pengingat Pembayaran SPP September 2026",
      category: "FINANCE",
      body: "Tagihan SPP September 2026 telah jatuh tempo pada 10 September. Mohon segera melunasi di TU atau transfer ke rekening sekolah lalu unggah bukti di aplikasi. (data demo)",
      audience: "STUDENTS",
      classNames: [],
      studentIndexes: unpaidSeptember(spec),
    },
  ];
}
