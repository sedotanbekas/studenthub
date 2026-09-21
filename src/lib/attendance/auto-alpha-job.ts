import type { JobContext } from "@/lib/auth/principal";
import { loadCalendarContext } from "@/lib/calendar/queries";
import { checkSchoolDay } from "@/lib/calendar/rules";
import { prisma, type Prisma, type Tx } from "@/lib/db";
import { runKeyedJob } from "@/lib/jobs/runner";
import type { JobOutcome, JobResult } from "@/lib/jobs/types";
import { holidaysLockKey } from "@/lib/lock-keys";
import { log } from "@/lib/log";
import { fromDbDate, toDbDate, type LocalDate, type SchoolTz } from "@/lib/time/zone";
import { lockKey, withTx } from "@/lib/tx";
import {
  AUTO_ALPHA_BATCH_SIZE,
  AUTO_ALPHA_JOB,
  activatedBefore,
  candidateCloseDates,
  chunk,
  isSettledRun,
  lookbackRunKeys,
  planDayClose,
  summarizeDrafts,
  type AttendanceDraft,
} from "./auto-alpha-rules";
import { hasTimeLeft } from "./retention";
import { sweepSharedDevice } from "./sweep";

/**
 * Handler job "attendance-auto-alpha" (tipe antrean, dipanggil tiap tick). Untuk setiap sekolah aktif,
 * setiap tanggal kandidat (hari ini setelah dayEndMinute + catch-up 7 hari) ditutup TEPAT SEKALI lewat
 * runKeyedJob("auto-alpha", schoolId, tanggal): siswa ACTIVE tanpa baris -> ALPHA (atau LEAVE bila izin
 * DISETUJUI mencakup tanggal), lalu sapuan SHARED_DEVICE.
 *
 * Penutupan satu hari = satu transaksi yang lebih dulu mengambil kunci libur nasional lalu libur sekolah
 * (holidaysLockKey, urutan sama seperti mutasi libur) sehingga penambahan libur tidak bisa menyelinap di
 * antara baca kalender dan INSERT (baris ALPHA basi di hari libur).
 */
const CLOSE_TX_TIMEOUT_MS = 60_000;

const SCHOOL_SELECT = { id: true, timezone: true, dayEndMinute: true, schoolDaysMask: true, createdAt: true } as const;
type CloseSchool = Prisma.SchoolGetPayload<{ select: typeof SCHOOL_SELECT }>;

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
  const schools = await prisma.school.findMany({ where: { isActive: true, ...schoolFilter(ctx) }, select: SCHOOL_SELECT, orderBy: { id: "asc" } });
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
  const tz: SchoolTz = school.timezone;
  const candidates = await tx.student.findMany({
    where: { schoolId: school.id, status: "ACTIVE", activatedAt: { lt: activatedBefore(date, tz) }, attendances: { none: { date: day } } },
    select: { id: true, status: true, activatedAt: true, currentClassId: true },
  });
  if (candidates.length === 0) return [];
  const leaves = await tx.leaveRequest.findMany({
    where: { schoolId: school.id, status: "APPROVED", startDate: { lte: day }, endDate: { gte: day } },
    select: { id: true, studentId: true, type: true, startDate: true, endDate: true },
  });
  const covering = leaves.map((leave) => ({ ...leave, startDate: fromDbDate(leave.startDate), endDate: fromDbDate(leave.endDate) }));
  return planDayClose(date, candidates, covering, tz);
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

/** Tutup satu hari sekolah (fn runKeyedJob). Hasilnya disimpan di JobRun.result. */
export function closeSchoolDay(school: CloseSchool, date: LocalDate, ctx: Pick<JobContext, "now" | "requestId">): Promise<JobResult> {
  return withTx(
    async (tx) => {
      await lockKey(tx, holidaysLockKey(null));
      await lockKey(tx, holidaysLockKey(school.id));
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
    },
    { timeout: CLOSE_TX_TIMEOUT_MS },
  );
}
