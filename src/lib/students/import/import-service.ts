import { createHash, randomBytes } from "node:crypto";
import type { ActionContext } from "@/lib/auth/principal";
import { writeAudit } from "@/lib/audit";
import { prisma, type Tx } from "@/lib/db";
import { AppError, conflict, unprocessable } from "@/lib/http/errors";
import type { SchoolScope } from "@/lib/tenant/scope";
import { toDbDate } from "@/lib/time/zone";
import { withTx } from "@/lib/tx";
import { issueTemporaryPassword, type TemporaryCredential } from "../guards";
import { recordNisnReleases } from "../nisn-claim";
import { loadSchoolContext, scopeFor, type SchoolContext } from "../records";
import { uniqueIndexOf } from "../unique-error";
import { IMPORT_CREATE_CHUNK, IMPORT_HASH_CONCURRENCY, IMPORT_MAX_FILE_BYTES, IMPORT_MAX_ROWS, IMPORT_TX_OPTIONS } from "./constants";
import { HEADER_LABELS, matchHeaders } from "./headers";
import { loadImportClasses, loadImportLookups, lockAndReleaseHolders } from "./lookups";
import { readImportFile } from "./read-file";
import type { ImportStudentsInput, ImportStudentsResult } from "./schemas";
import {
  buildClassLookup,
  collectLookupKeys,
  nonBlankRows,
  parseImportRows,
  validateImportRows,
  type ImportReport,
  type ParsedImportRow,
  type ValidatedImport,
} from "./validate-rows";

/**
 * Impor siswa XLSX/CSV: dry-run (laporan saja) lalu commit yang MEMVALIDASI ULANG seluruh berkas dan
 * bersifat all-or-nothing (satu transaksi 60 s). Kata sandi di-generate + di-hash sebelum transaksi.
 */
interface PreparedRow {
  readonly row: ParsedImportRow;
  readonly userId: string;
  readonly studentId: string;
  readonly credential: TemporaryCredential;
}

/** Salinan laporan untuk respons (array biasa). */
function toReportDto(report: ImportReport): ImportStudentsResult["report"] {
  return { ...report, rows: report.rows.map((r) => ({ ...r, errors: [...r.errors], warnings: [...r.warnings] })) };
}

/** Id pra-generate (Prisma MySQL tanpa createManyAndReturn); pola mirip cuid, unik & urut waktu. */
const newId = (): string => `c${Date.now().toString(36)}${randomBytes(10).toString("hex")}`;

async function readBytes(file: File): Promise<Uint8Array> {
  if (file.size > IMPORT_MAX_FILE_BYTES) throw new AppError(413, "PAYLOAD_TOO_LARGE", "Ukuran berkas impor maksimal 2 MiB.", { maxBytes: IMPORT_MAX_FILE_BYTES });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > IMPORT_MAX_FILE_BYTES) throw new AppError(413, "PAYLOAD_TOO_LARGE", "Ukuran berkas impor maksimal 2 MiB.", { maxBytes: IMPORT_MAX_FILE_BYTES });
  return bytes;
}

async function validateFile(bytes: Uint8Array, scope: SchoolScope, school: SchoolContext, activate: boolean, now: Date): Promise<ValidatedImport> {
  const sheet = await readImportFile(bytes);
  const header = matchHeaders(sheet.header, activate);
  if (header.missing.length > 0) {
    const missing = header.missing.map((field) => HEADER_LABELS[field]);
    throw unprocessable("IMPORT_HEADERS_MISSING", `Kolom wajib tidak ditemukan: ${missing.join(", ")}.`, { missing });
  }
  if (header.duplicates.length > 0) {
    const duplicates = header.duplicates.map((field) => HEADER_LABELS[field]);
    throw unprocessable("IMPORT_HEADERS_DUPLICATE", `Kolom ganda: ${duplicates.join(", ")}.`, { duplicates });
  }
  const rows = nonBlankRows(sheet.rows, header.columns);
  if (rows.length === 0) throw unprocessable("IMPORT_EMPTY", "Berkas tidak berisi baris data siswa.");
  if (rows.length > IMPORT_MAX_ROWS) throw unprocessable("IMPORT_TOO_MANY_ROWS", `Maksimal ${IMPORT_MAX_ROWS} baris data per impor.`, { rows: rows.length });
  const classes = await loadImportClasses(prisma, scope, school);
  const parsed = parseImportRows(rows, header.columns, buildClassLookup(classes, school.activeAcademicYearId));
  const lookups = await loadImportLookups(prisma, scope, collectLookupKeys(parsed));
  const activation = { schoolId: school.id, schoolActive: school.isActive, timezone: school.timezone, activeAcademicYearId: school.activeAcademicYearId, now };
  return validateImportRows(parsed, lookups, { activate, activation });
}

async function prepareRows(rows: readonly ParsedImportRow[], now: Date): Promise<PreparedRow[]> {
  const prepared: PreparedRow[] = [];
  for (let i = 0; i < rows.length; i += IMPORT_HASH_CONCURRENCY) {
    const chunk = rows.slice(i, i + IMPORT_HASH_CONCURRENCY);
    const credentials = await Promise.all(chunk.map(() => issueTemporaryPassword(now)));
    chunk.forEach((row, j) => prepared.push({ row, userId: newId(), studentId: newId(), credential: credentials[j] as TemporaryCredential }));
  }
  return prepared;
}

function userRow(p: PreparedRow, scope: SchoolScope, activate: boolean) {
  return {
    id: p.userId,
    role: "STUDENT" as const,
    name: p.row.name ?? "",
    schoolId: scope.schoolId,
    passwordHash: p.credential.hash,
    isActive: activate,
    mustChangePassword: true,
    tempPasswordExpiresAt: p.credential.expiresAt,
  };
}

function studentRow(p: PreparedRow, scope: SchoolScope, activate: boolean, now: Date) {
  const r = p.row;
  return {
    id: p.studentId,
    userId: p.userId,
    schoolId: scope.schoolId,
    nisn: r.nisn ?? "",
    activeNisn: activate ? r.nisn : null,
    nis: r.nis ?? "",
    gender: r.gender ?? ("MALE" as const),
    birthPlace: r.birthPlace,
    birthDate: r.birthDate === null ? null : toDbDate(r.birthDate),
    address: r.address,
    guardianName: r.guardianName,
    guardianPhone: r.guardianPhone,
    status: activate ? ("ACTIVE" as const) : ("DRAFT" as const),
    currentClassId: r.class?.id ?? null,
    activatedAt: activate ? now : null,
    sppAmount: r.sppAmount,
  };
}

interface CommitInput {
  readonly scope: SchoolScope;
  readonly prepared: readonly PreparedRow[];
  readonly activate: boolean;
  readonly fileSha256: string;
}

async function commitImport(tx: Tx, input: CommitInput, ctx: ActionContext): Promise<void> {
  const { scope, prepared, activate } = input;
  const nisns = prepared.flatMap((p) => (p.row.nisn ? [p.row.nisn] : []));
  const released = activate ? await lockAndReleaseHolders(tx, nisns, ctx) : [];
  for (let i = 0; i < prepared.length; i += IMPORT_CREATE_CHUNK) {
    await tx.user.createMany({ data: prepared.slice(i, i + IMPORT_CREATE_CHUNK).map((p) => userRow(p, scope, activate)) });
  }
  for (let i = 0; i < prepared.length; i += IMPORT_CREATE_CHUNK) {
    await tx.student.createMany({ data: prepared.slice(i, i + IMPORT_CREATE_CHUNK).map((p) => studentRow(p, scope, activate, ctx.now)) });
  }
  await recordNisnReleases(tx, released, ctx);
  await writeAudit(
    tx,
    {
      action: "student.import",
      entityType: "School",
      entityId: scope.schoolId,
      schoolId: scope.schoolId,
      after: { count: prepared.length, activate, fileSha256: input.fileSha256, nisnReleased: released.length },
    },
    ctx,
  );
}

async function commitWithConflictMapping(input: CommitInput, ctx: ActionContext): Promise<void> {
  try {
    await withTx((tx) => commitImport(tx, input, ctx), IMPORT_TX_OPTIONS);
  } catch (error) {
    if (uniqueIndexOf(error) !== null) throw conflict("IMPORT_CONFLICT", "Data berubah sejak validasi (NISN/NIS kini sudah dipakai). Ulangi validasi.");
    throw error;
  }
}

export async function importStudents(ctx: ActionContext, schoolId: string | undefined, input: ImportStudentsInput): Promise<ImportStudentsResult> {
  const scope = scopeFor(ctx, schoolId);
  const school = await loadSchoolContext(prisma, scope);
  const bytes = await readBytes(input.file);
  const validated = await validateFile(bytes, scope, school, input.activate, ctx.now);
  const report = toReportDto(validated.report);
  if (input.dryRun) return { dryRun: true, report };
  if (validated.report.errorRows > 0) {
    throw unprocessable("IMPORT_INVALID", "Masih ada baris bermasalah; tidak ada data yang disimpan.", { report });
  }
  const prepared = await prepareRows(validated.rows, ctx.now);
  const fileSha256 = createHash("sha256").update(bytes).digest("hex");
  await commitWithConflictMapping({ scope, prepared, activate: input.activate, fileSha256 }, ctx);
  const credentials = prepared.map((p) => ({
    row: p.row.row,
    nisn: p.row.nisn ?? "",
    nis: p.row.nis ?? "",
    name: p.row.name ?? "",
    className: p.row.class?.name ?? null,
    temporaryPassword: p.credential.plain,
  }));
  return { dryRun: false, report, created: prepared.length, credentials };
}
