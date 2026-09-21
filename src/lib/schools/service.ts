import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { revokeSchoolSessions } from "@/lib/auth/sessions";
import type { ActionContext } from "@/lib/auth/principal";
import type { Tx } from "@/lib/db";
import { conflict, notFound, unprocessable } from "@/lib/http/errors";
import { notifySchoolAdmins } from "@/lib/notifications/notify";
import { schoolSettingsChangedEvent } from "@/lib/notifications/templates/schools";
import type { SchoolScope } from "@/lib/tenant/scope";
import { lockKey, withTx } from "@/lib/tx";
import { SCHOOL_INCLUDE, toSnapshot } from "./dto";
import { getPlatformSchoolDetail, getSchoolDto, SCHOOL_NOT_FOUND_MESSAGE } from "./queries";
import {
  DEFAULT_SCHOOL_CONFIG,
  describeSchoolChanges,
  mergeSchoolPatch,
  roundCoordinate,
  validateSchoolConfig,
  type SchoolChanges,
  type SchoolConfig,
  type SchoolField,
  type SchoolSnapshot,
} from "./rules";
import type { CreateSchoolInput, PlatformSchoolDetailDto, SchoolDto, UpdateSchoolInput, UpdateSchoolSettingsInput } from "./schemas";

/** Kunci aplikasi per sekolah untuk read-merge-write konfigurasi (bukan FOR UPDATE baris School). */
export const schoolConfigLockKey = (schoolId: string): string => `school-config:${schoolId}`;

/** 422 SCHOOL_CONFIG_INVALID dengan daftar galat per kolom. */
export function assertValidSchoolConfig(config: SchoolConfig): void {
  const errors = validateSchoolConfig(config);
  if (errors.length > 0) {
    throw unprocessable("SCHOOL_CONFIG_INVALID", errors[0]?.message ?? "Konfigurasi sekolah tidak valid.", { errors });
  }
}

async function assertRegion(tx: Tx, provinceCode: string, cityCode: string): Promise<void> {
  const city = await tx.city.findUnique({ where: { code: cityCode }, select: { provinceCode: true } });
  if (!city || city.provinceCode !== provinceCode) {
    throw unprocessable("CITY_NOT_IN_PROVINCE", "Kabupaten/kota tidak ditemukan pada provinsi yang dipilih.", { provinceCode, cityCode });
  }
}

async function assertNpsnFree(tx: Tx, npsn: string, exceptId?: string): Promise<void> {
  const holder = await tx.school.findFirst({ where: { npsn, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  if (holder) throw conflict("NPSN_TAKEN", "NPSN sudah dipakai sekolah lain.");
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2002";
}

/** P2002 pada School hanya mungkin dari NPSN (balapan dua request bersamaan). */
function mapNpsnRace(error: unknown): never {
  if (isUniqueViolation(error)) throw conflict("NPSN_TAKEN", "NPSN sudah dipakai sekolah lain.");
  throw error;
}

function withRoundedCoordinates<T extends { latitude?: number; longitude?: number }>(input: T): T {
  return {
    ...input,
    ...(input.latitude !== undefined ? { latitude: roundCoordinate(input.latitude) } : {}),
    ...(input.longitude !== undefined ? { longitude: roundCoordinate(input.longitude) } : {}),
  };
}

/** Nilai create lengkap: kolom opsional yang tidak dikirim memakai default skema. */
function snapshotFromCreate(input: CreateSchoolInput): SchoolSnapshot {
  const rounded = withRoundedCoordinates(input);
  const base: SchoolSnapshot = {
    ...DEFAULT_SCHOOL_CONFIG,
    npsn: null,
    address: null,
    name: rounded.name,
    provinceCode: rounded.provinceCode,
    cityCode: rounded.cityCode,
    latitude: rounded.latitude,
    longitude: rounded.longitude,
    timezone: rounded.timezone,
  };
  return mergeSchoolPatch(base, rounded);
}

/** SUPER_ADMIN membuat sekolah baru (geofence, jadwal, rekening opsional). */
export async function createSchool(input: CreateSchoolInput, ctx: ActionContext): Promise<PlatformSchoolDetailDto> {
  const snapshot = snapshotFromCreate(input);
  assertValidSchoolConfig(snapshot);
  const id = await withTx(async (tx) => {
    await assertRegion(tx, snapshot.provinceCode, snapshot.cityCode);
    if (snapshot.npsn) await assertNpsnFree(tx, snapshot.npsn);
    const created = await tx.school.create({ data: snapshot, select: { id: true } });
    await writeAudit(tx, { action: "school.create", entityType: "School", entityId: created.id, schoolId: created.id, after: snapshot }, ctx);
    return created.id;
  }).catch(mapNpsnRace);
  return getPlatformSchoolDetail(id);
}

function pickFields(source: SchoolSnapshot, fields: readonly SchoolField[]): Partial<SchoolSnapshot> {
  return Object.fromEntries(fields.map((field) => [field, source[field]]));
}

function changeData(after: SchoolSnapshot, changes: SchoolChanges, now: Date): Prisma.SchoolUncheckedUpdateInput {
  return {
    ...pickFields(after, changes.changedFields),
    ...(changes.geofenceChanged ? { geofenceUpdatedAt: now } : {}),
    ...(changes.bankChanged ? { bankChangedAt: now } : {}),
  };
}

type Applied = { schoolId: string; schoolName: string; before: SchoolSnapshot; after: SchoolSnapshot; changes: SchoolChanges };

/** Kunci -> baca -> merge -> validasi -> tulis perubahan saja. null bila tidak ada yang berubah. */
async function applySchoolPatch(tx: Tx, schoolId: string, patch: Partial<SchoolSnapshot>, now: Date): Promise<Applied | null> {
  await lockKey(tx, schoolConfigLockKey(schoolId));
  const row = await tx.school.findUnique({ where: { id: schoolId }, include: SCHOOL_INCLUDE });
  if (!row) throw notFound(SCHOOL_NOT_FOUND_MESSAGE);
  const before = toSnapshot(row);
  const after = mergeSchoolPatch(before, withRoundedCoordinates(patch));
  assertValidSchoolConfig(after);
  const changes = describeSchoolChanges(before, after);
  if (changes.changedFields.length === 0) return null;
  if (changes.groups.includes("REGION")) await assertRegion(tx, after.provinceCode, after.cityCode);
  if (changes.changedFields.includes("npsn") && after.npsn) await assertNpsnFree(tx, after.npsn, schoolId);
  await tx.school.update({ where: { id: schoolId }, data: changeData(after, changes, now) });
  return { schoolId, schoolName: after.name, before, after, changes };
}

async function auditChange(tx: Tx, action: string, applied: Applied, ctx: ActionContext): Promise<void> {
  const fields = applied.changes.changedFields;
  await writeAudit(
    tx,
    { action, entityType: "School", entityId: applied.schoolId, schoolId: applied.schoolId, before: pickFields(applied.before, fields), after: pickFields(applied.after, fields) },
    ctx,
  );
}

function bankOf(after: SchoolSnapshot): { bankName: string; bankAccountNumber: string; bankAccountHolder: string } | null {
  const { bankName, bankAccountNumber, bankAccountHolder } = after;
  return bankName && bankAccountNumber && bankAccountHolder ? { bankName, bankAccountNumber, bankAccountHolder } : null;
}

/**
 * SUPER_ADMIN mengubah kolom apa pun (termasuk lokasi/geofence/zona waktu/rekening). Hasil merge
 * divalidasi utuh; perubahan diaudit before/after dan diberitahukan ke semua admin sekolah aktif.
 */
export async function updateSchool(schoolId: string, patch: UpdateSchoolInput, ctx: ActionContext): Promise<PlatformSchoolDetailDto> {
  await withTx(async (tx) => {
    const applied = await applySchoolPatch(tx, schoolId, patch, ctx.now);
    if (!applied) return;
    await auditChange(tx, "school.update", applied, ctx);
    const event = schoolSettingsChangedEvent({
      schoolId,
      schoolName: applied.schoolName,
      changedBy: ctx.principal?.name ?? "Super admin",
      groups: applied.changes.groups,
      bank: applied.changes.bankChanged ? bankOf(applied.after) : undefined,
    });
    await notifySchoolAdmins(tx, schoolId, event, ctx);
  }).catch(mapNpsnRace);
  return getPlatformSchoolDetail(schoolId);
}

/**
 * Admin sekolah (atau SUPER_ADMIN dengan ?schoolId) mengubah jadwal & hari sekolah saja. Baris
 * absensi yang sudah ada TIDAK ditulis ulang; aturan baru berlaku untuk check-in berikutnya.
 */
export async function updateSchoolSettings(scope: SchoolScope, patch: UpdateSchoolSettingsInput, ctx: ActionContext): Promise<SchoolDto> {
  await withTx(async (tx) => {
    const applied = await applySchoolPatch(tx, scope.schoolId, patch, ctx.now);
    if (applied) await auditChange(tx, "school.settings_update", applied, ctx);
  });
  return getSchoolDto(scope.schoolId);
}

async function assertSchoolExists(tx: Tx, schoolId: string): Promise<void> {
  const school = await tx.school.findUnique({ where: { id: schoolId }, select: { id: true } });
  if (!school) throw notFound(SCHOOL_NOT_FOUND_MESSAGE);
}

/** Nonaktifkan sekolah: semua sesi pengguna sekolah dicabut (berlaku di request berikutnya). */
export async function deactivateSchool(
  schoolId: string,
  reason: string,
  ctx: ActionContext,
): Promise<{ id: string; isActive: boolean; revokedSessions: number }> {
  return withTx(async (tx) => {
    const updated = await tx.school.updateMany({ where: { id: schoolId, isActive: true }, data: { isActive: false } });
    if (updated.count === 0) {
      await assertSchoolExists(tx, schoolId);
      throw conflict("SCHOOL_ALREADY_INACTIVE", "Sekolah sudah nonaktif.");
    }
    const revokedSessions = await revokeSchoolSessions(tx, schoolId, "ACCOUNT_DISABLED", ctx.now);
    await writeAudit(
      tx,
      { action: "school.deactivate", entityType: "School", entityId: schoolId, schoolId, before: { isActive: true }, after: { isActive: false, reason, revokedSessions } },
      ctx,
    );
    return { id: schoolId, isActive: false, revokedSessions };
  });
}

/** Aktifkan kembali sekolah; pengguna sekolah perlu login ulang. */
export async function reactivateSchool(schoolId: string, ctx: ActionContext): Promise<{ id: string; isActive: boolean }> {
  return withTx(async (tx) => {
    const updated = await tx.school.updateMany({ where: { id: schoolId, isActive: false }, data: { isActive: true } });
    if (updated.count === 0) {
      await assertSchoolExists(tx, schoolId);
      throw conflict("SCHOOL_ALREADY_ACTIVE", "Sekolah sudah aktif.");
    }
    await writeAudit(
      tx,
      { action: "school.reactivate", entityType: "School", entityId: schoolId, schoolId, before: { isActive: false }, after: { isActive: true } },
      ctx,
    );
    return { id: schoolId, isActive: true };
  });
}
