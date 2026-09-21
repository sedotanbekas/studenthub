import type { AttendanceStatus, GradePredicate, ReportCardStatus } from "@prisma/client";
import type { LocalDate } from "@/lib/time/zone";

/**
 * Aturan murni rapor (desain 03 §E, PLAN "Rapor"): predikat K13 relatif KKM, rata-rata, kelengkapan,
 * rekap kehadiran, kesiapan & pemilihan rapor yang diterbitkan. Tanpa Prisma.
 */
export const MIN_SCORE = 0;
export const MAX_SCORE = 100;

/** Nilai/KKM valid: bilangan bulat 0..100. */
export function isValidScore(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_SCORE && value <= MAX_SCORE;
}

/**
 * Predikat metode interval K13 relatif KKM, hanya aritmetika bilangan bulat:
 * A bila 3s >= KKM + 200, B bila 3s >= 2·KKM + 100, C bila s >= KKM, selain itu D.
 * KKM 75 -> A >= 92, B >= 84, C >= 75. Masukan di luar bilangan bulat 0..100 -> RangeError.
 */
export function computePredicate(score: number, kkm: number): GradePredicate {
  if (!isValidScore(score)) throw new RangeError(`Nilai rapor tidak valid: ${score}`);
  if (!isValidScore(kkm)) throw new RangeError(`KKM tidak valid: ${kkm}`);
  if (3 * score >= kkm + 200) return "A";
  if (3 * score >= 2 * kkm + 100) return "B";
  if (score >= kkm) return "C";
  return "D";
}

/** Rata-rata nilai dibulatkan 2 desimal; tanpa nilai -> null. */
export function averageScore(scores: readonly number[]): number | null {
  if (scores.length === 0) return null;
  const sum = scores.reduce((acc, score) => acc + score, 0);
  return Math.round((sum * 100) / scores.length) / 100;
}

/** Deskripsi: trim + rapatkan spasi; kosong -> null. */
export function normalizeDescription(raw: string | null | undefined): string | null {
  const clean = (raw ?? "").replace(/\s+/g, " ").trim();
  return clean.length === 0 ? null : clean;
}

// ----------------------------------------------------------------------------- kehadiran

export interface AttendanceSummary {
  readonly sick: number;
  readonly permit: number;
  readonly absent: number;
}

export const ZERO_ATTENDANCE: AttendanceSummary = Object.freeze({ sick: 0, permit: 0, absent: 0 });

const SUMMARY_FIELD: Readonly<Partial<Record<AttendanceStatus, keyof AttendanceSummary>>> = { SAKIT: "sick", IZIN: "permit", ALPHA: "absent" };

function addToSummary(summary: AttendanceSummary, status: AttendanceStatus, count: number): AttendanceSummary {
  const field = SUMMARY_FIELD[status];
  return field ? { ...summary, [field]: summary[field] + count } : summary;
}

/** SAKIT -> sick, IZIN -> permit, ALPHA -> absent; HADIR & TERLAMBAT tidak dihitung. */
export function summarizeAttendance(rows: ReadonlyArray<{ status: AttendanceStatus; count: number }>): AttendanceSummary {
  return rows.reduce((acc, row) => addToSummary(acc, row.status, row.count), ZERO_ATTENDANCE);
}

/** Rekap per siswa dari groupBy (studentId, status). Siswa tanpa baris tidak muncul (anggap nol). */
export function summarizeAttendanceByStudent(
  rows: ReadonlyArray<{ studentId: string; status: AttendanceStatus; count: number }>,
): ReadonlyMap<string, AttendanceSummary> {
  return rows.reduce(
    (acc, row) => new Map(acc).set(row.studentId, addToSummary(acc.get(row.studentId) ?? ZERO_ATTENDANCE, row.status, row.count)),
    new Map<string, AttendanceSummary>(),
  );
}

/** Rentang rekap: awal semester .. min(akhir semester, closedThrough); null bila belum ada hari tertutup. */
export function attendanceWindow(termStart: LocalDate, termEnd: LocalDate, closed: LocalDate): { from: LocalDate; to: LocalDate } | null {
  const to = termEnd < closed ? termEnd : closed;
  return to < termStart ? null : { from: termStart, to };
}

// ----------------------------------------------------------------------------- kelengkapan & kesiapan

export interface MappedSubject {
  readonly subjectId: string;
  readonly sortOrder: number;
}

const bySortOrder = (a: MappedSubject, b: MappedSubject): number => a.sortOrder - b.sortOrder || (a.subjectId < b.subjectId ? -1 : 1);

/** Mapel terpetakan yang belum dinilai, urut sortOrder. Nilai mapel di luar pemetaan diabaikan. */
export function missingSubjectIds(mapped: readonly MappedSubject[], graded: Iterable<string>): string[] {
  const done = new Set(graded);
  return [...mapped].sort(bySortOrder).filter((m) => !done.has(m.subjectId)).map((m) => m.subjectId);
}

export interface CardGrades {
  readonly reportCardId: string;
  readonly studentId: string;
  readonly status: ReportCardStatus;
  readonly gradedSubjectIds: readonly string[];
}

export interface CardRef {
  readonly reportCardId: string;
  readonly studentId: string;
}

export interface IncompleteCard {
  /** null = siswa belum punya rapor di kelas & semester ini. */
  readonly reportCardId: string | null;
  readonly studentId: string;
  readonly missingSubjectIds: string[];
}

export interface Readiness {
  readonly ready: CardRef[];
  readonly incomplete: Array<IncompleteCard & { readonly reportCardId: string }>;
  readonly noReportCard: string[];
  readonly published: CardRef[];
}

const refOf = (card: CardGrades): CardRef => ({ reportCardId: card.reportCardId, studentId: card.studentId });

export interface ReadinessInput {
  readonly mapped: readonly MappedSubject[];
  readonly cards: readonly CardGrades[];
  readonly activeStudentIds: readonly string[];
  /** Siswa yang sudah punya rapor semester ini (kelas mana pun). */
  readonly studentsWithCard: ReadonlySet<string>;
}

/** Kesiapan terbit per kelas: DRAFT lengkap / belum lengkap, siswa aktif tanpa rapor, sudah terbit. */
export function classifyReadiness(input: ReadinessInput): Readiness {
  const drafts = input.cards.filter((c) => c.status === "DRAFT");
  const withMissing = drafts.map((c) => ({ card: c, missing: missingSubjectIds(input.mapped, c.gradedSubjectIds) }));
  return {
    ready: withMissing.filter((x) => x.missing.length === 0).map((x) => refOf(x.card)),
    incomplete: withMissing.filter((x) => x.missing.length > 0).map((x) => ({ ...refOf(x.card), missingSubjectIds: x.missing })),
    noReportCard: input.activeStudentIds.filter((id) => !input.studentsWithCard.has(id)),
    published: input.cards.filter((c) => c.status === "PUBLISHED").map(refOf),
  };
}

export interface PublishSelectionInput {
  readonly mapped: readonly MappedSubject[];
  /** Rapor kelas & semester ini (DRAFT dan PUBLISHED). */
  readonly cards: readonly CardGrades[];
  /** null = seluruh kelas. */
  readonly requestedStudentIds: readonly string[] | null;
  /** Siswa aktif kelas ini yang belum punya rapor semester ini (hanya dipakai tanpa studentIds). */
  readonly activeWithoutCard: readonly string[];
}

export interface PublishSelection {
  readonly toPublish: CardGrades[];
  readonly incomplete: IncompleteCard[];
}

const allMissing = (mapped: readonly MappedSubject[], studentId: string): IncompleteCard => ({
  reportCardId: null,
  studentId,
  missingSubjectIds: missingSubjectIds(mapped, []),
});

/**
 * Pilih rapor DRAFT yang diterbitkan. Semua-atau-tidak: bila ada yang belum lengkap (termasuk siswa
 * tanpa rapor), pemanggil menolak seluruh permintaan. Rapor yang sudah terbit dilewati (idempoten).
 */
export function selectPublishTargets(input: PublishSelectionInput): PublishSelection {
  const byStudent = new Map(input.cards.map((c) => [c.studentId, c]));
  const requested = input.requestedStudentIds === null ? null : [...new Set(input.requestedStudentIds)];
  const drafts = requested === null
    ? input.cards.filter((c) => c.status === "DRAFT")
    : requested.flatMap((id) => {
        const found = byStudent.get(id);
        return found && found.status === "DRAFT" ? [found] : [];
      });
  const withoutCard = requested === null ? input.activeWithoutCard : requested.filter((id) => !byStudent.has(id));
  const incompleteDrafts = drafts
    .map((c) => ({ reportCardId: c.reportCardId, studentId: c.studentId, missingSubjectIds: missingSubjectIds(input.mapped, c.gradedSubjectIds) }))
    .filter((x) => x.missingSubjectIds.length > 0);
  const blocked = new Set(incompleteDrafts.map((x) => x.reportCardId));
  return {
    toPublish: drafts.filter((c) => !blocked.has(c.reportCardId)),
    incomplete: [...incompleteDrafts, ...withoutCard.map((id) => allMissing(input.mapped, id))],
  };
}

/** Urutan tampil nilai: mapel terpetakan menurut sortOrder kelas, lalu sisanya menurut nama mapel. */
export function orderGradesForDisplay<T extends { readonly subjectId: string; readonly subjectName: string }>(
  grades: readonly T[],
  sortOrderBySubject: ReadonlyMap<string, number>,
): T[] {
  const rank = (g: T): number => sortOrderBySubject.get(g.subjectId) ?? Number.MAX_SAFE_INTEGER;
  return [...grades].sort((a, b) => rank(a) - rank(b) || a.subjectName.localeCompare(b.subjectName, "id") || (a.subjectId < b.subjectId ? -1 : 1));
}
