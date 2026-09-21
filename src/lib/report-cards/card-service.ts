import { writeAudit } from "@/lib/audit";
import type { ActionContext } from "@/lib/auth/principal";
import { prisma, type Tx } from "@/lib/db";
import { conflict, notFound, unprocessable } from "@/lib/http/errors";
import type { SchoolScope } from "@/lib/tenant/scope";
import { withTx } from "@/lib/tx";
import { assertClassInTermYear, findClass, findTerm, scopeOf } from "./context";
import { loadReportCardDetail } from "./detail";
import { assertNonePublished, lockCardRows, lockGrades } from "./grade-writes";
import type { CreateReportCardInput, ReportCardDetailDto } from "./schemas";

/**
 * Buat rapor kosong (DRAFT) untuk satu siswa & hapus rapor DRAFT. Kelas rapor = kelas siswa saat ini.
 * Kunci: `grades:<termId>:<classId>` PALING AWAL, lalu baca ulang siswa (kelas bisa berubah sebelum kunci).
 */
const studentNotFound = () => notFound("Siswa tidak ditemukan.");

async function assertNoCardYet(tx: Tx, scope: SchoolScope, studentId: string, termId: string): Promise<void> {
  const existing = await tx.reportCard.findFirst({ where: { schoolId: scope.schoolId, studentId, termId }, select: { id: true } });
  if (existing) throw conflict("REPORT_CARD_EXISTS", "Siswa sudah memiliki rapor untuk semester ini.", { reportCardId: existing.id });
}

async function createInTx(tx: Tx, scope: SchoolScope, input: CreateReportCardInput, classId: string, ctx: ActionContext): Promise<string> {
  await lockGrades(tx, input.termId, classId);
  const student = await tx.student.findFirst({ where: { id: input.studentId, schoolId: scope.schoolId }, select: { status: true, currentClassId: true } });
  if (!student) throw studentNotFound();
  if (student.currentClassId !== classId) throw conflict("STUDENT_STATE_CHANGED", "Kelas siswa berubah bersamaan. Silakan ulangi.");
  if (student.status !== "ACTIVE") throw unprocessable("STUDENT_NOT_ELIGIBLE", "Rapor baru hanya dapat dibuat untuk siswa aktif.");
  const term = await findTerm(tx, scope, input.termId);
  const klass = await findClass(tx, scope, classId);
  assertClassInTermYear(term, klass);
  await assertNoCardYet(tx, scope, input.studentId, term.id);
  const card = await tx.reportCard.create({
    data: { schoolId: scope.schoolId, studentId: input.studentId, termId: term.id, classId: klass.id, classNameSnapshot: klass.name },
    select: { id: true },
  });
  await writeAudit(
    tx,
    { action: "report_card.create", entityType: "ReportCard", entityId: card.id, schoolId: scope.schoolId, after: { studentId: input.studentId, termId: term.id, classId: klass.id } },
    ctx,
  );
  return card.id;
}

/** POST /school/report-cards: rapor DRAFT kosong untuk siswa AKTIF yang sudah ditempatkan di kelas. */
export async function createReportCard(ctx: ActionContext, schoolId: string | undefined, input: CreateReportCardInput): Promise<ReportCardDetailDto> {
  const scope = scopeOf(ctx, schoolId);
  const student = await prisma.student.findFirst({ where: { id: input.studentId, schoolId: scope.schoolId }, select: { currentClassId: true } });
  if (!student) throw studentNotFound();
  await findTerm(prisma, scope, input.termId);
  const classId = student.currentClassId;
  if (!classId) throw unprocessable("STUDENT_NOT_ELIGIBLE", "Siswa belum ditempatkan di kelas.");
  return withTx(async (tx) => {
    const id = await createInTx(tx, scope, input, classId, ctx);
    return loadReportCardDetail(tx, scope, id, ctx.now);
  });
}

/** DELETE /school/report-cards/{id}: hanya DRAFT (nilai ikut terhapus lewat FK cascade). */
export async function deleteReportCard(ctx: ActionContext, schoolId: string | undefined, id: string): Promise<{ id: string }> {
  const scope = scopeOf(ctx, schoolId);
  const ref = await prisma.reportCard.findFirst({ where: { id, schoolId: scope.schoolId }, select: { termId: true, classId: true } });
  if (!ref) throw notFound("Rapor tidak ditemukan.");
  return withTx(async (tx) => {
    await lockGrades(tx, ref.termId, ref.classId);
    const [card] = await lockCardRows(tx, scope, [id]);
    if (!card) throw notFound("Rapor tidak ditemukan.");
    assertNonePublished([card]);
    const gradeCount = await tx.reportCardGrade.count({ where: { reportCardId: id } });
    const { count } = await tx.reportCard.deleteMany({ where: { id, schoolId: scope.schoolId, status: "DRAFT" } });
    if (count !== 1) throw conflict("STATE_CONFLICT", "Rapor berubah bersamaan. Silakan ulangi.");
    await writeAudit(
      tx,
      { action: "report_card.delete", entityType: "ReportCard", entityId: id, schoolId: scope.schoolId, before: { studentId: card.studentId, termId: card.termId, classId: card.classId, gradeCount } },
      ctx,
    );
    return { id };
  });
}
