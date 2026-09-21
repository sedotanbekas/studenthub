import type { Prisma } from "@prisma/client";
import { assertNoViolation, requireSchool, schoolToday } from "@/lib/academics/guards";
import { normalizeName } from "@/lib/academics/rules";
import { onCalendarChanged } from "@/lib/attendance/calendar-sync";
import { writeAudit } from "@/lib/audit";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import type { Tx } from "@/lib/db";
import { conflict, notFound, unprocessable } from "@/lib/http/errors";
import { holidaysLockKey } from "@/lib/lock-keys";
import type { SchoolScope } from "@/lib/tenant/scope";
import { toDbDate, wibDate, type LocalDate } from "@/lib/time/zone";
import { lockKey, withTx } from "@/lib/tx";
import { HOLIDAY_SELECT, toHolidayDto } from "./dto";
import { unionRange } from "./ranges";
import { backdateLimitDate, isWithinBackdateLimit, validateHolidayRange } from "./rules";
import type { CreateHolidayInput, HolidayDto, UpdateHolidayInput } from "./schemas";

/**
 * Mutasi libur sekolah (/school/holidays) & nasional (/platform/holidays).
 * Urutan di satu transaksi: kunci `holidays:<schoolId|national>` PALING AWAL (sebelum membaca apa pun,
 * lihat src/lib/lock-keys.ts) -> baca sekolah & baris terbaru -> validasi -> tulis HANYA field yang
 * dikirim -> writeAudit (before/after dari baris terbaru) -> onCalendarChanged.
 * schoolId libur sekolah SELALU dari SchoolScope; admin sekolah dibatasi backdate 7 hari.
 */
interface HolidayTarget {
  /** NULL = libur nasional. */
  readonly schoolId: string | null;
  readonly limitBackdate: boolean;
  readonly today: LocalDate;
}

/** Kunci libur sekolah diambil dulu, baru sekolahnya dibaca. Target hanya lahir di sini (kunci terpegang). */
async function lockSchoolTarget(tx: Tx, scope: SchoolScope, ctx: ActionContext): Promise<HolidayTarget> {
  await lockKey(tx, holidaysLockKey(scope.schoolId));
  const school = await requireSchool(tx, scope);
  return { schoolId: school.id, limitBackdate: requirePrincipal(ctx).role === "SCHOOL_ADMIN", today: schoolToday(school, ctx.now) };
}

async function lockNationalTarget(tx: Tx, ctx: ActionContext): Promise<HolidayTarget> {
  await lockKey(tx, holidaysLockKey(null));
  return { schoolId: null, limitBackdate: false, today: wibDate(ctx.now) };
}

const auditAction = (target: HolidayTarget, verb: string): string => `${target.schoolId ? "holiday" : "national_holiday"}.${verb}`;

function assertBackdate(target: HolidayTarget, startDate: LocalDate): void {
  if (!target.limitBackdate || isWithinBackdateLimit(startDate, target.today)) return;
  throw unprocessable(
    "HOLIDAY_BACKDATE_LIMIT",
    `Admin sekolah hanya dapat mengelola libur yang dimulai paling awal ${backdateLimitDate(target.today)}. Hubungi super admin untuk libur yang lebih lama.`,
  );
}

async function assertNotDuplicate(tx: Tx, target: HolidayTarget, name: string, startDate: LocalDate, excludeId: string | null): Promise<void> {
  const existing = await tx.holiday.findFirst({
    where: { schoolId: target.schoolId, name, startDate: toDbDate(startDate), ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (existing) throw conflict("HOLIDAY_DUPLICATE", "Libur dengan nama dan tanggal mulai yang sama sudah ada.");
}

async function findHoliday(tx: Tx, target: HolidayTarget, id: string): Promise<HolidayDto> {
  const row = await tx.holiday.findFirst({ where: { id, schoolId: target.schoolId }, select: HOLIDAY_SELECT });
  if (!row) throw notFound("Libur tidak ditemukan.");
  return toHolidayDto(row);
}

async function createHoliday(tx: Tx, target: HolidayTarget, input: CreateHolidayInput, ctx: ActionContext): Promise<HolidayDto> {
  assertNoViolation(validateHolidayRange(input));
  assertBackdate(target, input.startDate);
  const name = normalizeName(input.name);
  await assertNotDuplicate(tx, target, name, input.startDate, null);
  const row = await tx.holiday.create({
    data: { schoolId: target.schoolId, name, startDate: toDbDate(input.startDate), endDate: toDbDate(input.endDate) },
    select: HOLIDAY_SELECT,
  });
  const dto = toHolidayDto(row);
  await writeAudit(tx, { action: auditAction(target, "create"), entityType: "Holiday", entityId: row.id, schoolId: target.schoolId, after: dto }, ctx);
  await onCalendarChanged(tx, { schoolId: target.schoolId, from: dto.startDate, to: dto.endDate, kind: "ADDED" }, ctx);
  return dto;
}

/** Data UPDATE hanya dari field yang dikirim; kolom lain tidak ditulis ulang. */
function holidayPatchData(patch: UpdateHolidayInput): Prisma.HolidayUpdateInput {
  return {
    ...(patch.name === undefined ? {} : { name: normalizeName(patch.name) }),
    ...(patch.startDate === undefined ? {} : { startDate: toDbDate(patch.startDate) }),
    ...(patch.endDate === undefined ? {} : { endDate: toDbDate(patch.endDate) }),
  };
}

async function updateHoliday(tx: Tx, target: HolidayTarget, id: string, patch: UpdateHolidayInput, ctx: ActionContext): Promise<HolidayDto> {
  const current = await findHoliday(tx, target, id);
  assertBackdate(target, current.startDate);
  const next = {
    name: patch.name === undefined ? current.name : normalizeName(patch.name),
    startDate: patch.startDate ?? current.startDate,
    endDate: patch.endDate ?? current.endDate,
  };
  assertNoViolation(validateHolidayRange(next));
  assertBackdate(target, next.startDate);
  if (next.name !== current.name || next.startDate !== current.startDate) await assertNotDuplicate(tx, target, next.name, next.startDate, id);
  const row = await tx.holiday.update({ where: { id }, data: holidayPatchData(patch), select: HOLIDAY_SELECT });
  const dto = toHolidayDto(row);
  await writeAudit(tx, { action: auditAction(target, "update"), entityType: "Holiday", entityId: id, schoolId: target.schoolId, before: current, after: dto }, ctx);
  const changed = unionRange(current, dto);
  await onCalendarChanged(tx, { schoolId: target.schoolId, from: changed.startDate, to: changed.endDate, kind: "CHANGED" }, ctx);
  return dto;
}

async function deleteHoliday(tx: Tx, target: HolidayTarget, id: string, ctx: ActionContext): Promise<{ id: string }> {
  const current = await findHoliday(tx, target, id);
  assertBackdate(target, current.startDate);
  await tx.holiday.delete({ where: { id } });
  await writeAudit(tx, { action: auditAction(target, "delete"), entityType: "Holiday", entityId: id, schoolId: target.schoolId, before: current }, ctx);
  await onCalendarChanged(tx, { schoolId: target.schoolId, from: current.startDate, to: current.endDate, kind: "REMOVED" }, ctx);
  return { id };
}

// ----------------------------------------------------------------------------- libur sekolah

export function createSchoolHoliday(scope: SchoolScope, input: CreateHolidayInput, ctx: ActionContext): Promise<HolidayDto> {
  return withTx(async (tx) => createHoliday(tx, await lockSchoolTarget(tx, scope, ctx), input, ctx));
}

export function updateSchoolHoliday(scope: SchoolScope, id: string, patch: UpdateHolidayInput, ctx: ActionContext): Promise<HolidayDto> {
  return withTx(async (tx) => updateHoliday(tx, await lockSchoolTarget(tx, scope, ctx), id, patch, ctx));
}

export function deleteSchoolHoliday(scope: SchoolScope, id: string, ctx: ActionContext): Promise<{ id: string }> {
  return withTx(async (tx) => deleteHoliday(tx, await lockSchoolTarget(tx, scope, ctx), id, ctx));
}

// ----------------------------------------------------------------------------- libur nasional (SUPER_ADMIN)

export function createNationalHoliday(input: CreateHolidayInput, ctx: ActionContext): Promise<HolidayDto> {
  return withTx(async (tx) => createHoliday(tx, await lockNationalTarget(tx, ctx), input, ctx));
}

export function updateNationalHoliday(id: string, patch: UpdateHolidayInput, ctx: ActionContext): Promise<HolidayDto> {
  return withTx(async (tx) => updateHoliday(tx, await lockNationalTarget(tx, ctx), id, patch, ctx));
}

export function deleteNationalHoliday(id: string, ctx: ActionContext): Promise<{ id: string }> {
  return withTx(async (tx) => deleteHoliday(tx, await lockNationalTarget(tx, ctx), id, ctx));
}
