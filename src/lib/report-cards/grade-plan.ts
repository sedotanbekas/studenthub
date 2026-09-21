import type { GradePredicate } from "@prisma/client";
import { computePredicate, type AttendanceSummary, ZERO_ATTENDANCE } from "./rules";

/**
 * Rencana tulis nilai rapor (murni): validasi per baris, upsert/hapus nilai dengan snapshot mapel &
 * predikat, penyegaran snapshot saat terbit, dan pengelompokan rekap kehadiran. Tanpa Prisma.
 */
export type GradeRowErrorCode = "DUPLICATE_STUDENT" | "DUPLICATE_SUBJECT" | "STUDENT_NOT_ELIGIBLE" | "REPORT_CARD_OTHER_CLASS" | "SUBJECT_NOT_IN_CLASS";

export interface GradeRowError {
  readonly index: number;
  readonly studentId?: string;
  readonly subjectId?: string;
  readonly code: GradeRowErrorCode;
  readonly message: string;
}

/** Indeks kemunculan kedua dst. dari kunci yang sama. */
function duplicateIndexes<T>(items: readonly T[], keyOf: (item: T) => string): number[] {
  const firstIndex = new Map<string, number>();
  items.forEach((item, index) => {
    if (!firstIndex.has(keyOf(item))) firstIndex.set(keyOf(item), index);
  });
  return items.flatMap((item, index) => (firstIndex.get(keyOf(item)) === index ? [] : [index]));
}

export function duplicateStudentErrors(entries: ReadonlyArray<{ readonly studentId: string }>): GradeRowError[] {
  return duplicateIndexes(entries, (e) => e.studentId).map((index) => ({
    index,
    studentId: entries[index]?.studentId ?? "",
    code: "DUPLICATE_STUDENT",
    message: "Siswa muncul lebih dari sekali dalam permintaan.",
  }));
}

export interface GradeRoster {
  /** Siswa AKTIF di kelas + siswa yang sudah punya rapor kelas & semester ini. */
  readonly eligible: ReadonlySet<string>;
  /** Siswa layak yang rapor semester ini ada di kelas LAIN (studentId -> nama kelas snapshot). */
  readonly otherClass: ReadonlyMap<string, string>;
}

export function eligibilityErrors(entries: ReadonlyArray<{ readonly studentId: string }>, roster: GradeRoster): GradeRowError[] {
  return entries.flatMap((entry, index): GradeRowError[] => {
    if (!roster.eligible.has(entry.studentId)) {
      return [{ index, studentId: entry.studentId, code: "STUDENT_NOT_ELIGIBLE", message: "Siswa bukan siswa aktif kelas ini dan tidak memiliki rapor kelas ini." }];
    }
    const other = roster.otherClass.get(entry.studentId);
    if (other === undefined) return [];
    return [{
      index,
      studentId: entry.studentId,
      code: "REPORT_CARD_OTHER_CLASS",
      message: `Siswa sudah memiliki rapor semester ini di kelas ${other}. Hapus rapor draf itu terlebih dahulu.`,
    }];
  });
}

/** Nilai satu rapor: mapel ganda, atau mapel yang tidak dipetakan ke kelas dan belum dinilai di rapor ini. */
export function cardSubjectErrors(
  grades: ReadonlyArray<{ readonly subjectId: string }>,
  mapped: ReadonlySet<string>,
  alreadyGraded: ReadonlySet<string>,
): GradeRowError[] {
  const duplicates = new Set(duplicateIndexes(grades, (g) => g.subjectId));
  return grades.flatMap((grade, index): GradeRowError[] => {
    if (duplicates.has(index)) {
      return [{ index, subjectId: grade.subjectId, code: "DUPLICATE_SUBJECT", message: "Mapel muncul lebih dari sekali dalam permintaan." }];
    }
    if (mapped.has(grade.subjectId) || alreadyGraded.has(grade.subjectId)) return [];
    return [{ index, subjectId: grade.subjectId, code: "SUBJECT_NOT_IN_CLASS", message: "Mapel tidak dipetakan ke kelas rapor ini." }];
  });
}

// ----------------------------------------------------------------------------- rencana tulis

export interface SubjectInfo {
  readonly id: string;
  readonly name: string;
  readonly kkm: number;
}

export interface GradeWrite {
  readonly reportCardId: string;
  readonly subjectId: string;
  /** null = hapus nilai. */
  readonly score: number | null;
  /** undefined = pertahankan deskripsi tersimpan (nilai baru: null); null = hapus deskripsi. */
  readonly description: string | null | undefined;
}

export interface GradeValues {
  readonly subjectNameSnapshot: string;
  readonly kkmSnapshot: number;
  readonly score: number;
  readonly predicate: GradePredicate;
  readonly description: string | null;
}

export interface ExistingGrade extends GradeValues {
  readonly id: string;
  readonly reportCardId: string;
  readonly subjectId: string;
}

export interface GradePlan {
  readonly creates: Array<GradeValues & { readonly reportCardId: string; readonly subjectId: string }>;
  readonly updates: Array<{ readonly id: string; readonly data: GradeValues }>;
  readonly deleteIds: string[];
  readonly unchanged: number;
}

const gradeKey = (reportCardId: string, subjectId: string): string => `${reportCardId}\u0000${subjectId}`;

function valuesOf(score: number, description: string | null, subject: SubjectInfo): GradeValues {
  return {
    subjectNameSnapshot: subject.name,
    kkmSnapshot: subject.kkm,
    score,
    predicate: computePredicate(score, subject.kkm),
    description,
  };
}

const sameValues = (a: GradeValues, b: GradeValues): boolean =>
  a.score === b.score && a.description === b.description && a.predicate === b.predicate
  && a.kkmSnapshot === b.kkmSnapshot && a.subjectNameSnapshot === b.subjectNameSnapshot;

type Step = { kind: "create"; row: GradePlan["creates"][number] } | { kind: "update"; row: GradePlan["updates"][number] }
  | { kind: "delete"; id: string } | { kind: "skip" };

function stepOf(write: GradeWrite, current: ExistingGrade | undefined, subjects: ReadonlyMap<string, SubjectInfo>): Step {
  if (write.score === null) return current ? { kind: "delete", id: current.id } : { kind: "skip" };
  const subject = subjects.get(write.subjectId);
  if (!subject) throw new Error(`Info mapel ${write.subjectId} tidak dimuat`);
  const description = write.description === undefined ? (current?.description ?? null) : write.description;
  const data = valuesOf(write.score, description, subject);
  if (!current) return { kind: "create", row: { reportCardId: write.reportCardId, subjectId: write.subjectId, ...data } };
  return sameValues(current, data) ? { kind: "skip" } : { kind: "update", row: { id: current.id, data } };
}

/** Upsert per [reportCardId, subjectId] dengan snapshot nama mapel, KKM, dan predikat terkini. */
export function planGradeWrites(
  writes: readonly GradeWrite[],
  existing: readonly ExistingGrade[],
  subjects: ReadonlyMap<string, SubjectInfo>,
): GradePlan {
  const current = new Map(existing.map((g) => [gradeKey(g.reportCardId, g.subjectId), g]));
  const steps = writes.map((w) => stepOf(w, current.get(gradeKey(w.reportCardId, w.subjectId)), subjects));
  return {
    creates: steps.flatMap((s) => (s.kind === "create" ? [s.row] : [])),
    updates: steps.flatMap((s) => (s.kind === "update" ? [s.row] : [])),
    deleteIds: steps.flatMap((s) => (s.kind === "delete" ? [s.id] : [])),
    unchanged: steps.filter((s, i) => s.kind === "skip" && writes[i]?.score !== null).length,
  };
}

// ----------------------------------------------------------------------------- saat terbit

export interface RefreshGroup {
  readonly ids: string[];
  readonly subjectNameSnapshot: string;
  readonly kkmSnapshot: number;
  readonly predicate: GradePredicate;
}

/** Snapshot mapel & predikat dihitung ulang dari mapel terkini; satu grup per (mapel, predikat). */
export function groupGradeRefresh(
  grades: ReadonlyArray<{ readonly id: string; readonly subjectId: string; readonly score: number }>,
  subjects: ReadonlyMap<string, SubjectInfo>,
): RefreshGroup[] {
  const groups = new Map<string, RefreshGroup>();
  for (const grade of grades) {
    const subject = subjects.get(grade.subjectId);
    if (!subject) throw new Error(`Info mapel ${grade.subjectId} tidak dimuat`);
    const predicate = computePredicate(grade.score, subject.kkm);
    const key = `${grade.subjectId}\u0000${predicate}`;
    const group = groups.get(key) ?? { ids: [], subjectNameSnapshot: subject.name, kkmSnapshot: subject.kkm, predicate };
    groups.set(key, { ...group, ids: [...group.ids, grade.id] });
  }
  return [...groups.values()];
}

export interface AttendanceSnapshotGroup {
  readonly ids: string[];
  readonly sickDays: number;
  readonly permitDays: number;
  readonly absentDays: number;
}

/** Rapor dengan rekap sakit/izin/alpha sama digabung agar ditulis dengan sedikit updateMany. */
export function groupAttendanceSnapshots(
  cards: ReadonlyArray<{ readonly id: string; readonly studentId: string }>,
  summaries: ReadonlyMap<string, AttendanceSummary>,
): AttendanceSnapshotGroup[] {
  const groups = new Map<string, AttendanceSnapshotGroup>();
  for (const card of cards) {
    const s = summaries.get(card.studentId) ?? ZERO_ATTENDANCE;
    const key = `${s.sick}:${s.permit}:${s.absent}`;
    const group = groups.get(key) ?? { ids: [], sickDays: s.sick, permitDays: s.permit, absentDays: s.absent };
    groups.set(key, { ...group, ids: [...group.ids, card.id] });
  }
  return [...groups.values()];
}
