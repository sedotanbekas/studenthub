import type { JobContext } from "@/lib/auth/principal";
import { loadCalendarContext } from "@/lib/calendar/queries";
import { checkSchoolDay, type DayReason } from "@/lib/calendar/rules";
import { prisma, type Prisma, type Tx } from "@/lib/db";
import { runKeyedJob } from "@/lib/jobs/runner";
import type { JobOutcome, JobResult } from "@/lib/jobs/types";
import { log } from "@/lib/log";
import { fromDbDate, toDbDate, type LocalDate } from "@/lib/time/zone";
import { withTx } from "@/lib/tx";
import {
  AUTO_ALPHA_BATCH_SIZE,
  AUTO_ALPHA_JOB,
  candidateCloseDates,
  chunk,
  eligibilityCutoff,
  isSettledRun,
  lookbackRunKeys,
  planDayClose,
  summarizeDrafts,
  type AttendanceDraft,
} from "./auto-alpha-rules";
import { lockCalendarShared } from "./calendar-locks";
import { hasTimeLeft } from "./retention";
import { sweepSharedDevice } from "./sweep";

/**
 * Handler job "attendance-auto-alpha" (tipe antrean, dipanggil tiap tick). Untuk setiap sekolah aktif,
 * setiap tanggal kandidat (hari ini setelah dayEndMinute + catch-up 7 hari) ditutup TEPAT SEKALI lewat
 * runKeyedJob("auto-alpha", schoolId, tanggal): siswa ACTIVE tanpa baris -> ALPHA (atau LEAVE bila izin
 * DISETUJUI mencakup tanggal), lalu sapuan SHARED_DEVICE.
 *
 * Penutupan satu hari = satu transaksi yang lebih dulu mengambil kunci BERSAMA libur nasional lalu libur
 * sekolah (lockCalendarShared, urutan sama seperti mutasi libur) sehingga penambahan libur tidak bisa
 * menyelinap di antara baca kalender dan INSERT (baris ALPHA basi di hari libur); penutupan sekolah lain &
 * persetujuan izin tidak saling menunggu.
 */
const CLOSE_TX_TIMEOUT_MS = 60_000;

export const CLOSE_SCHOOL_SELECT = {
  id: true, isActive: true, timezone: true, dayEndMinute: true, checkInCloseMinute: true, schoolDaysMask: true, createdAt: true,
} as const;
export type CloseSchool = Prisma.SchoolGetPayload<{ select: typeof CLOSE_SCHOOL_SELECT }>;

type OutcomeCounts = Record<JobOutcome, number>;

/** Cakupan test: bila ctx.scope diisi, hanya schoolIds yang disebut (kosong = tidak ada). */
function schoolFilter(ctx: JobContext): Prisma.SchoolWhereInput {
  return ctx.scope ? { id: { in: [...(ctx.scope.schoolIds ?? [])] } } : {};
}

/** Kunci (schoolId|tanggal) JobRun auto-alpha yang tidak perlu dicoba lagi, satu kueri untuk semua sekolah. */
async function settledKeys(schoolIds: readonly string[], now: Date): Promise<ReadonlySet<string>> {
  if (schoolIds.length === 0) return new Set();
  const runs = await prisma.jobRun.findMany({
    where: { job: AUTO_ALPHA_JOB, scopeKey: { in: [...schoolIds] }, runKey: { in: lookbackRunKeys(now) } },
    select: { scopeKey: true, runKey: true, status: true, attempts: true },
  });
  return new Set(runs.filter(isSettledRun).map((run) => `${run.scopeKey}|${run.runKey}`));
}

function doneDatesOf(schoolId: string, settled: ReadonlySet<string>): ReadonlySet<LocalDate> {
  const prefix = `${schoolId}|`;
  return new Set([...settled].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)));
}

export async function runAutoAlpha(ctx: JobContext): Promise<JobResult> {
  const schools = await prisma.school.findMany({ where: { isActive: true, ...schoolFilter(ctx) }, select: CLOSE_SCHOOL_SELECT, orderBy: { id: "asc" } });
  const settled = await settledKeys(schools.map((school) => school.id), ctx.now);
  const counts: OutcomeCounts = { ran: 0, skipped: 0, failed: 0 };
  let hasMore = false;
  for (const school of schools) {
    const dates = candidateCloseDates(ctx.now, school, doneDatesOf(school.id, settled));
    for (const date of dates) {
      if (!hasTimeLeft(ctx.deadline)) {
        hasMore = true;
        break;
      }
      const outcome = await runKeyedJob(AUTO_ALPHA_JOB, school.id, date, () => closeSchoolDay(school, date, ctx), ctx);
      counts[outcome] += 1;
    }
    if (hasMore) break;
  }
  return { schools: schools.length, ...counts, hasMore };
}

async function loadDrafts(tx: Tx, school: CloseSchool, date: LocalDate): Promise<AttendanceDraft[]> {
  const day = toDbDate(date);
  const candidates = await tx.student.findMany({
    where: { schoolId: school.id, status: "ACTIVE", activatedAt: { lt: eligibilityCutoff(date, school) }, attendances: { none: { date: day } } },
    select: { id: true, status: true, activatedAt: true, currentClassId: true },
  });
  if (candidates.length === 0) return [];
  const leaves = await tx.leaveRequest.findMany({
    where: { schoolId: school.id, status: "APPROVED", startDate: { lte: day }, endDate: { gte: day } },
    select: { id: true, studentId: true, type: true, startDate: true, endDate: true },
  });
  const covering = leaves.map((leave) => ({ ...leave, startDate: fromDbDate(leave.startDate), endDate: fromDbDate(leave.endDate) }));
  return planDayClose(date, candidates, covering, school);
}

/**
 * createMany skipDuplicates (INSERT IGNORE) per potongan 500: baris yang ditulis bersamaan oleh
 * check-in/izin/koreksi dilewati. Baris draf tidak mungkin melanggar CHECK (AUTO_ALPHA=ALPHA,
 * LEAVE=IZIN/SAKIT + leaveRequestId, tanpa lateMinutes) sehingga IGNORE hanya menelan duplikat.
 */
async function insertDrafts(tx: Tx, schoolId: string, date: LocalDate, drafts: readonly AttendanceDraft[]): Promise<number> {
  const day = toDbDate(date);
  let inserted = 0;
  for (const part of chunk(drafts, AUTO_ALPHA_BATCH_SIZE)) {
    const result = await tx.attendance.createMany({ data: part.map((draft) => ({ ...draft, schoolId, date: day })), skipDuplicates: true });
    inserted += result.count;
  }
  return inserted;
}

/** Hasil penutupan satu hari (disimpan apa adanya di JobRun.result). */
export type DayCloseResult =
  | { readonly date: LocalDate; readonly skipped: "NON_SCHOOL_DAY"; readonly reason: DayReason }
  | {
      readonly date: LocalDate;
      readonly planned: number;
      readonly inserted: number;
      readonly alphaPlanned: number;
      readonly leavePlanned: number;
      readonly anomaliesSwept: number;
    };

/**
 * Tutup satu hari sekolah DI DALAM transaksi pemanggil yang SUDAH memegang kunci kalender (lockCalendarShared
 * atau kunci libur eksklusif): hari non-sekolah dilewati; siswa wajib absen tanpa baris -> ALPHA/LEAVE; sapuan
 * SHARED_DEVICE. Idempoten (anti-join + INSERT IGNORE). Dipakai tick, tutup-ulang manual super admin, dan
 * sinkronisasi kalender untuk tanggal di luar jendela lookback.
 */
export async function closeDayLocked(tx: Tx, school: CloseSchool, date: LocalDate, ctx: Pick<JobContext, "now" | "requestId">): Promise<DayCloseResult> {
  const day = checkSchoolDay(date, await loadCalendarContext(tx, school, { from: date, to: date }));
  if (!day.isSchoolDay) return { date, skipped: "NON_SCHOOL_DAY", reason: day.reason };
  const drafts = await loadDrafts(tx, school, date);
  const inserted = await insertDrafts(tx, school.id, date, drafts);
  if (inserted !== drafts.length) {
    log.warn("auto-alpha: sebagian baris sudah ditulis proses lain", { schoolId: school.id, date, planned: drafts.length, inserted, requestId: ctx.requestId });
  }
  const anomaliesSwept = await sweepSharedDevice(tx, school.id, date, ctx.now);
  const { alpha, leave } = summarizeDrafts(drafts);
  return { date, planned: drafts.length, inserted, alphaPlanned: alpha, leavePlanned: leave, anomaliesSwept };
}

/** Tutup satu hari sekolah (fn runKeyedJob) dalam transaksinya sendiri. Hasilnya disimpan di JobRun.result. */
export function closeSchoolDay(school: CloseSchool, date: LocalDate, ctx: Pick<JobContext, "now" | "requestId">): Promise<JobResult> {
  return withTx(
    async (tx) => {
      await lockCalendarShared(tx, school.id);
      return closeDayLocked(tx, school, date, ctx);
    },
    { timeout: CLOSE_TX_TIMEOUT_MS },
  );
}

/**
 * Catat hari yang ditutup di luar tick (tutup-ulang manual / sinkronisasi kalender) sebagai JobRun
 * SUCCEEDED agar analitik tidak menganggapnya belum ditutup. Hanya dipanggil untuk tanggal yang tidak
 * sedang dikerjakan tick (di luar lookback) atau oleh super admin; balapan dengan tick aman karena
 * penutupan idempoten (finish tick yang kalah hanya dicatat sebagai peringatan).
 */
export async function markDayClosed(tx: Tx, schoolId: string, date: LocalDate, result: DayCloseResult, now: Date): Promise<void> {
  const key = { job: AUTO_ALPHA_JOB, scopeKey: schoolId, runKey: date };
  const done = { status: "SUCCEEDED" as const, startedAt: now, finishedAt: now, result: result as Prisma.InputJsonObject, error: null };
  await tx.jobRun.upsert({ where: { job_scopeKey_runKey: key }, create: { ...key, attempts: 1, ...done }, update: done });
}
