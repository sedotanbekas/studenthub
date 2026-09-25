import { writeAudit } from "@/lib/audit";
import type { ActionContext } from "@/lib/auth/principal";
import { prisma, type Tx } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import type { SchoolScope } from "@/lib/tenant/scope";
import { lockKey, withTx } from "@/lib/tx";
import { SCHOOL_NOT_FOUND_MESSAGE } from "./queries";
import { schoolConfigLockKey } from "./service";
import { EMPTY_STORED_THEME, SCHOOL_THEME_SELECT, storedThemeOf, toSchoolThemeDto, toThemeAudit, toThemeColumns } from "./theme-dto";
import type { SchoolThemeDto, UpdateSchoolThemeInput } from "./theme-schemas";
import { sameStoredTheme, type StoredTheme } from "./theme-store-rules";

/**
 * Tema warna sekolah (GET/PUT/DELETE /school/theme). School adalah tenant itu sendiri: scope sudah
 * diverifikasi resolveSchoolScope, id tak dikenal (SUPER_ADMIN) -> 404. Mutasi memakai kunci
 * aplikasi yang sama dengan pengaturan sekolah (AppLock dulu, baru baris), audit di transaksi sama.
 */
export async function getSchoolTheme(scope: SchoolScope): Promise<SchoolThemeDto> {
  const row = await prisma.school.findUnique({ where: { id: scope.schoolId }, select: SCHOOL_THEME_SELECT });
  if (!row) throw notFound(SCHOOL_NOT_FOUND_MESSAGE);
  return toSchoolThemeDto(row);
}

function storedFromInput(input: UpdateSchoolThemeInput): StoredTheme {
  const { preset, ...colors } = input;
  return { preset: preset ?? null, colors };
}

/**
 * Kunci -> baca -> bandingkan -> tulis + audit. Tidak berubah -> tanpa tulis & tanpa audit.
 * `themeUpdatedAt` hanya bergerak bila isi kolom berubah.
 */
async function replaceTheme(tx: Tx, schoolId: string, next: StoredTheme, auditAction: string, ctx: ActionContext): Promise<void> {
  await lockKey(tx, schoolConfigLockKey(schoolId));
  const row = await tx.school.findUnique({ where: { id: schoolId }, select: SCHOOL_THEME_SELECT });
  if (!row) throw notFound(SCHOOL_NOT_FOUND_MESSAGE);
  const current = storedThemeOf(row);
  if (sameStoredTheme(current, next)) return;
  await tx.school.update({ where: { id: schoolId }, data: { ...toThemeColumns(next), themeUpdatedAt: ctx.now } });
  await writeAudit(
    tx,
    { action: auditAction, entityType: "School", entityId: schoolId, schoolId, before: toThemeAudit(current), after: toThemeAudit(next) },
    ctx,
  );
}

/** PUT: ganti utuh palet (warna sudah dinormalkan `#rrggbb` huruf kecil oleh skema). Audit `school.theme_update`. */
export async function updateSchoolTheme(scope: SchoolScope, input: UpdateSchoolThemeInput, ctx: ActionContext): Promise<SchoolThemeDto> {
  await withTx((tx) => replaceTheme(tx, scope.schoolId, storedFromInput(input), "school.theme_update", ctx));
  return getSchoolTheme(scope);
}

/** DELETE: kembali ke tema bawaan (semua kolom NULL). Audit `school.theme_reset`; sudah bawaan -> no-op. */
export async function resetSchoolTheme(scope: SchoolScope, ctx: ActionContext): Promise<SchoolThemeDto> {
  await withTx((tx) => replaceTheme(tx, scope.schoolId, EMPTY_STORED_THEME, "school.theme_reset", ctx));
  return getSchoolTheme(scope);
}
