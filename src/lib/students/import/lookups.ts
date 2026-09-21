import { Prisma } from "@prisma/client";
import type { ActionContext } from "@/lib/auth/principal";
import type { Tx } from "@/lib/db";
import { conflict, unprocessable } from "@/lib/http/errors";
import type { SchoolScope } from "@/lib/tenant/scope";
import type { StudentStatusValue } from "../constants";
import { releaseGraduates, type LockedHolder, type ReleasePolicy, type ReleasedHolder } from "../nisn-claim";
import type { SchoolContext } from "../records";
import type { ImportClass, ImportLookups } from "./validate-rows";

/** Query DB untuk impor: kelas sekolah, keunikan NISN/NIS, pemegang activeNisn (batch, ber-scope). */
const MAX_CLASSES = 2000;

export async function loadImportClasses(db: Tx, scope: SchoolScope, school: SchoolContext): Promise<ImportClass[]> {
  return db.schoolClass.findMany({
    where: { schoolId: scope.schoolId, isActive: true, ...(school.activeAcademicYearId ? { academicYearId: school.activeAcademicYearId } : {}) },
    select: { id: true, name: true, schoolId: true, isActive: true, academicYearId: true },
    orderBy: [{ gradeLevel: "asc" }, { name: "asc" }],
    take: MAX_CLASSES,
  });
}

export async function loadImportLookups(db: Tx, scope: SchoolScope, keys: { nisns: string[]; nis: string[] }): Promise<ImportLookups> {
  const [nisnRows, nisRows, holderRows] = await Promise.all([
    keys.nisns.length === 0 ? [] : db.student.findMany({ where: { schoolId: scope.schoolId, nisn: { in: keys.nisns } }, select: { nisn: true } }),
    keys.nis.length === 0 ? [] : db.student.findMany({ where: { schoolId: scope.schoolId, nis: { in: keys.nis } }, select: { nis: true } }),
    keys.nisns.length === 0
      ? []
      : db.student.findMany({
          where: { activeNisn: { in: keys.nisns }, schoolId: { not: scope.schoolId } },
          select: { activeNisn: true, status: true },
        }),
  ]);
  return {
    existingNisns: new Set(nisnRows.map((r) => r.nisn)),
    existingNisKeys: new Set(nisRows.map((r) => r.nis.toUpperCase())),
    holders: new Map(holderRows.flatMap((r) => (r.activeNisn ? [[r.activeNisn, r.status as StudentStatusValue] as const] : []))),
  };
}

/**
 * Di DALAM transaksi commit (setelah kunci aplikasi): kelas tujuan dibaca ULANG di bawah kunci
 * class:<id>; kelas yang kini nonaktif / hilang -> 422 CLASS_INACTIVE (tidak ada yang ditulis).
 */
export async function assertClassesStillActive(tx: Tx, scope: SchoolScope, classes: ReadonlyMap<string, string>): Promise<void> {
  if (classes.size === 0) return;
  const rows = await tx.schoolClass.findMany({ where: { id: { in: [...classes.keys()] }, schoolId: scope.schoolId, isActive: true }, select: { id: true } });
  const active = new Set(rows.map((row) => row.id));
  const inactive = [...classes].filter(([id]) => !active.has(id)).map(([, name]) => name);
  if (inactive.length > 0) {
    throw unprocessable("CLASS_INACTIVE", `Kelas sudah dinonaktifkan: ${inactive.join(", ")}. Ulangi validasi.`, { classNames: inactive });
  }
}

/**
 * Di DALAM transaksi commit: kunci pemegang activeNisn (id naik, FOR UPDATE) dalam SATU query.
 * Pemegang AKTIF/NONAKTIF (data berubah sejak validasi) -> 409 IMPORT_CONFLICT; pemegang LULUS dilepas
 * sekaligus (opt-in + kuota diperiksa releaseGraduates).
 */
export async function lockAndReleaseHolders(tx: Tx, nisns: readonly string[], ctx: ActionContext, policy: ReleasePolicy): Promise<ReleasedHolder[]> {
  if (nisns.length === 0) return [];
  const holders = await tx.$queryRaw<LockedHolder[]>`
    SELECT \`id\`, \`status\`, \`schoolId\`, \`userId\`, \`activeNisn\` FROM \`Student\`
    WHERE \`activeNisn\` IN (${Prisma.join([...nisns])}) ORDER BY \`id\` FOR UPDATE`;
  if (holders.some((holder) => holder.status !== "GRADUATED")) {
    throw conflict("IMPORT_CONFLICT", "Data berubah sejak validasi (NISN kini aktif di sekolah lain). Ulangi validasi.");
  }
  return releaseGraduates(tx, holders, ctx, policy);
}
