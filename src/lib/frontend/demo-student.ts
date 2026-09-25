import { averageScore, computePredicate } from "@/lib/report-cards/rules";
import type { Row } from "./types";

/**
 * Data contoh MILIK SATU SISWA untuk mode demo, dengan bentuk persis DTO API siswa
 * (OwnReportCardItem/Detail, StudentInvoice/Detail): tanpa objek `student`, tanpa rapor draf.
 * Tidak ada jalur yang boleh mengembalikan data siswa lain.
 */
const KKM = 75;
const SUBJECTS_IPA = ["Pendidikan Agama dan Budi Pekerti", "Pendidikan Pancasila", "Bahasa Indonesia", "Matematika", "Bahasa Inggris", "Fisika", "Kimia", "Biologi", "Informatika", "Pendidikan Jasmani, Olahraga, dan Kesehatan"];
const SUBJECTS_IPS = ["Pendidikan Agama dan Budi Pekerti", "Pendidikan Pancasila", "Bahasa Indonesia", "Matematika", "Bahasa Inggris", "Ekonomi", "Geografi", "Sosiologi", "Sejarah", "Pendidikan Jasmani, Olahraga, dan Kesehatan"];
const DESCRIPTIONS: Record<string, string> = {
  A: "Menunjukkan penguasaan yang sangat baik dan mampu menerapkan konsep secara mandiri.",
  B: "Menunjukkan penguasaan yang baik; perlu memperdalam penerapan konsep pada soal kontekstual.",
  C: "Mencapai tujuan pembelajaran; perlu latihan rutin untuk memperkuat pemahaman.",
  D: "Belum mencapai tujuan pembelajaran; perlu pendampingan dan remedial.",
};
const DEMO_BANK = { bankName: "Bank Contoh", bankAccountNumber: "1234567890", bankAccountHolder: "SMA Cendekia Nusantara", bankChangedAt: null, bankRecentlyChanged: false, notice: "Transfer hanya ke rekening resmi sekolah di atas. Simpan bukti transfer." };

interface CardSeed { readonly id: string; readonly termId: string; readonly termLabel: string; readonly className: string; readonly publishedAt: string; readonly offset: number }

const seq = (student: Row) => Number(String(student.id).replace(/\D/g, "")) || 0;
const classOf = (student: Row) => String((student.class as Row | undefined)?.name ?? "");

function cardSeeds(student: Row): CardSeed[] {
  const current = classOf(student);
  const id = String(student.id);
  if (current.startsWith("XI ")) {
    const previous = current.replace(/^XI /, "X ");
    return [
      { id: `rc-${id}-2`, termId: "term-2526-2", termLabel: "Semester Genap 2025/2026", className: previous, publishedAt: "2026-06-19T03:00:00.000Z", offset: 2 },
      { id: `rc-${id}-1`, termId: "term-2526-1", termLabel: "Semester Ganjil 2025/2026", className: previous, publishedAt: "2025-12-19T03:00:00.000Z", offset: 0 },
    ];
  }
  return [{ id: `rc-${id}-1`, termId: "term-2627-1", termLabel: "Semester Ganjil 2026/2027", className: current, publishedAt: "2026-09-24T03:00:00.000Z", offset: 0 }];
}

function grades(student: Row, seed: CardSeed): Row[] {
  const subjects = classOf(student).includes("IPS") ? SUBJECTS_IPS : SUBJECTS_IPA;
  const base = 78 + (seq(student) % 4) * 3 + seed.offset;
  return subjects.map((subjectName, i) => {
    const score = Math.min(100, base + ((i * 7) % 13) - 3);
    const predicate = computePredicate(score, KKM);
    return { subjectName, kkm: KKM, score, predicate, description: DESCRIPTIONS[predicate] ?? null };
  });
}

function cardDetail(student: Row, seed: CardSeed): Row {
  const list = grades(student, seed);
  return { id: seed.id, termId: seed.termId, termLabel: seed.termLabel, className: seed.className, publishedAt: seed.publishedAt, grades: list, attendance: { sick: seed.offset ? 1 : 0, permit: 1, absent: 0 }, average: averageScore(list.map(g => Number(g.score))) };
}

function reportCards(student: Row): Row[] {
  return cardSeeds(student).map(seed => {
    const { id, termId, termLabel, className, publishedAt, average } = cardDetail(student, seed);
    return { id, termId, termLabel, className, publishedAt, average };
  });
}

const MONTHS = [7, 8, 9] as const;
const MONTH_NAMES: Record<number, string> = { 7: "Juli", 8: "Agustus", 9: "September" };
const DETAIL_ONLY = new Set(["note", "paidAt", "voidReason", "payments", "submissions", "bankAccount"]);
const pad = (n: number) => String(n).padStart(2, "0");

function invoiceDetail(student: Row, month: number): Row {
  const amount = Number(student.sppAmount ?? 350000);
  const settled = month < 9 || String(student.id) === "s2";
  const pending = !settled && String(student.id) === "s3";
  const paidAmount = settled ? amount : 0;
  const id = `inv-${String(student.id)}-${month}`;
  const invoiceNo = `INV-2026-${String(seq(student) * 100 + month).padStart(6, "0")}`;
  const paidOn = `2026-${pad(month)}-08`;
  return {
    id, invoiceNo, title: `SPP ${MONTH_NAMES[month]} 2026`, periodYear: 2026, periodMonth: month, amount, paidAmount, remaining: amount - paidAmount,
    dueDate: `2026-${pad(month)}-10`, status: settled ? "PAID" : "UNPAID",
    displayStatus: settled ? "LUNAS" : pending ? "MENUNGGU_VERIFIKASI" : "JATUH_TEMPO", isOverdue: !settled,
    pendingSubmission: pending ? { id: `sub-${id}`, amount, createdAt: "2026-09-23T02:15:00.000Z" } : null,
    note: null, paidAt: settled ? `${paidOn}T04:00:00.000Z` : null, voidReason: null,
    payments: settled ? [{ id: `pay-${id}`, receiptNo: `KWT-2026-${invoiceNo.slice(-6)}`, amount, method: "TRANSFER", paidDate: paidOn, voided: false, createdAt: `${paidOn}T04:00:00.000Z` }] : [],
    submissions: [],
    bankAccount: DEMO_BANK,
  };
}

function invoices(student: Row): Row[] {
  return [...MONTHS].reverse().map(month => Object.fromEntries(Object.entries(invoiceDetail(student, month)).filter(([key]) => !DETAIL_ONLY.has(key))));
}

function profile(student: Row): Row {
  return { name: student.name, nisn: student.nisn, nis: student.nis, gender: student.gender, className: classOf(student), status: student.status, school: { name: "SMA Cendekia Nusantara" } };
}

/** Daftar/objek milik `student` untuk jalur /student/*; jalur yang tidak dikenal -> []. */
export function studentDemoRows(path: string, student: Row): unknown {
  if (path === "/student/report-cards") return reportCards(student);
  if (path === "/student/invoices") return invoices(student);
  if (path === "/student/payment-info") return DEMO_BANK;
  if (path === "/student/profile") return profile(student);
  return [];
}

/** Detail satu rekaman milik `student` (mis. rapor lengkap dengan nilai); id milik siswa lain -> null. */
export function studentDemoDetail(path: string, id: string, student: Row): Row | null {
  if (path === "/student/report-cards") {
    const seed = cardSeeds(student).find(s => s.id === id);
    return seed ? cardDetail(student, seed) : null;
  }
  if (path === "/student/invoices") {
    const month = MONTHS.find(m => `inv-${String(student.id)}-${m}` === id);
    return month === undefined ? null : invoiceDetail(student, month);
  }
  return null;
}
