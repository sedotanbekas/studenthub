import { writeAudit } from "@/lib/audit";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { formatLocalDate } from "@/lib/billing/format";
import { assertRateLimit, getLimiter } from "@/lib/http/rate-limits";
import { XLSX_MIME } from "@/lib/students/import/constants";
import { formatMinute, localParts, type SchoolTz } from "@/lib/time/zone";
import { withTx } from "@/lib/tx";
import { assertClassInSchool } from "./monitoring-queries";
import { buildClassRecap, recapClassKeys, recapFileName } from "./monthly-recap-rules";
import {
  EXPORT_CAPS,
  EXPORT_TOO_LARGE,
  classLabelOf,
  classLabels,
  loadClassSource,
  loadRecapBase,
  loadSchoolSource,
  type RecapBase,
  type RecapCaps,
} from "./monthly-recap-queries";
import { isFinalMonth, monthLabelOf } from "./monthly-recap-dto";
import type { MonthlyRecapExportQuery } from "./monthly-recap-schemas";
import { buildRecapWorkbook, type RecapSheetInput } from "./monthly-recap-xlsx";

/**
 * GET /school/attendance/monthly-recap/export (A3): XLSX satu kelas atau semua kelas (satu sheet per kelas).
 * Kuota EXPORT dicek sebelum dan dihitung SETELAH berkas berhasil dibuat (unduhan gagal tidak memakan kuota).
 * Diaudit attendance.recap_export (AuditLog saja, urutan kunci terakhir).
 */

interface ExportPlan {
  readonly sheets: RecapSheetInput[];
  readonly className: string | null;
  readonly entityType: "SchoolClass" | "School";
  readonly entityId: string;
  readonly studentCount: number;
}

async function oneClassPlan(base: RecapBase, classId: string, caps: RecapCaps): Promise<ExportPlan> {
  const klass = await assertClassInSchool(base.scope, classId);
  const source = await loadClassSource(base.school, klass.id, base.range, caps, EXPORT_TOO_LARGE);
  const recap = buildClassRecap({ classKey: klass.id, days: base.days, closedThrough: base.closed, ...source });
  const labels = await classLabels(base.school.id, recap.students.flatMap((s) => s.otherClassIds));
  return {
    sheets: [{ className: klass.name, recap, classLabel: (id) => classLabelOf(id, labels) }],
    className: klass.name,
    entityType: "SchoolClass",
    entityId: klass.id,
    studentCount: recap.students.length,
  };
}

async function allClassesPlan(base: RecapBase, caps: RecapCaps): Promise<ExportPlan> {
  const source = await loadSchoolSource(base.school, base.range, caps);
  const ids = [...source.rows.map((r) => r.classId), ...source.candidates.map((c) => c.currentClassId)];
  const labels = await classLabels(base.school.id, ids);
  const classLabel = (id: string | null) => classLabelOf(id, labels);
  const sheets = recapClassKeys(source.candidates, source.rows, labels).map((classKey) => ({
    className: classLabel(classKey),
    recap: buildClassRecap({ classKey, days: base.days, closedThrough: base.closed, ...source }),
    classLabel,
  }));
  return { sheets, className: null, entityType: "School", entityId: base.school.id, studentCount: new Set(sheets.flatMap((s) => s.recap.students.map((st) => st.studentId))).size };
}

function finalLine(base: RecapBase): string {
  return base.closed < base.range.from ? "Belum ada hari yang ditutup di bulan ini" : `Data final s.d. ${formatLocalDate(base.closed < base.range.to ? base.closed : base.range.to)}`;
}

function notFinalLine(base: RecapBase): string | null {
  if (isFinalMonth(base)) return null;
  const open = base.range.to > base.closed ? "hari berjalan belum dihitung" : "";
  const unclosed = base.unclosed.length ? `${base.unclosed.length} hari belum ditutup sehingga alpa otomatis bisa bertambah` : "";
  return `Belum final: ${[open, unclosed].filter(Boolean).join("; ")}.`;
}

function generatedAt(now: Date, tz: SchoolTz): string {
  const p = localParts(now, tz);
  const [year, month, day] = p.ymd.split("-");
  return `${day}/${month}/${year} ${formatMinute(p.minuteOfDay).replace(":", ".")} ${tz}`;
}

function xlsxResponse(bytes: Uint8Array, filename: string): Response {
  return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: XLSX_MIME }), {
    status: 200,
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function exportMonthlyRecap(ctx: ActionContext, query: MonthlyRecapExportQuery, caps: RecapCaps = EXPORT_CAPS): Promise<Response> {
  const limitKey = `export:${requirePrincipal(ctx).userId}`;
  assertRateLimit("EXPORT", limitKey);
  const base = await loadRecapBase(ctx, query.schoolId, query.month);
  const plan = query.classId ? await oneClassPlan(base, query.classId, caps) : await allClassesPlan(base, caps);
  const bytes = await buildRecapWorkbook({
    schoolName: base.school.name,
    monthLabel: monthLabelOf(base.month),
    finalLine: finalLine(base),
    notFinalLine: notFinalLine(base),
    generatedAt: generatedAt(ctx.now, base.school.timezone),
    days: base.days,
    sheets: plan.sheets,
  });
  const after = { month: base.month, classCount: plan.sheets.length, studentCount: plan.studentCount, isFinal: isFinalMonth(base) };
  await withTx((tx) => writeAudit(tx, { action: "attendance.recap_export", entityType: plan.entityType, entityId: plan.entityId, schoolId: base.school.id, after }, ctx));
  getLimiter("EXPORT").hit(limitKey);
  return xlsxResponse(bytes, recapFileName(base.month, plan.className));
}
