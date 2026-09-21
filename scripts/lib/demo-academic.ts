/**
 * Rapor & pengumuman demo (hanya lewat seed demo: DB *_staging / *_dev / *_test), dibuat lewat service
 * domain dengan konteks admin sekolah demo (kunci, snapshot, notifikasi & audit sama dengan API).
 *
 * - Rapor Semester Ganjil kelas pertama: semua mapel terpetakan dinilai (nilai deterministik) lalu
 *   diterbitkan. Idempoten: hanya siswa tanpa rapor / rapor DRAFT di kelas itu yang dinilai & diterbitkan;
 *   rapor TERBIT (atau rapor siswa di kelas lain) tidak disentuh.
 * - Tiga pengumuman terbit (semua siswa, satu kelas, siswa tertentu); judul = kunci idempoten per sekolah.
 */
import { createAnnouncement } from "../../src/lib/announcements/service";
import { createAnnouncementBody } from "../../src/lib/announcements/schemas";
import { prisma } from "../../src/lib/db";
import { loadMappedSubjects } from "../../src/lib/report-cards/context";
import { upsertClassGrades } from "../../src/lib/report-cards/grade-service";
import { publishReportCards } from "../../src/lib/report-cards/publish-service";
import { bulkGradesBody, publishBody } from "../../src/lib/report-cards/schemas";
import { DEMO_REPORT_CLASS_INDEX, demoAnnouncementPlans, demoGradeDescription, demoScore, type DemoAnnouncementPlan } from "./demo-academic-plan";
import { adminContext, collectDomainWarning, type DemoSchoolRef, type DemoStudentRef } from "./demo-context";
import type { DemoSchoolSpec } from "./demo-data";

export interface DemoReportCardSummary {
  readonly className: string;
  /** Rapor TERBIT Semester Ganjil untuk siswa demo kelas itu. */
  readonly published: number;
}

/** Siswa kelas rapor yang belum punya rapor atau rapornya masih DRAFT di kelas yang sama. */
async function pendingReportTargets(ref: DemoSchoolRef, classId: string, targets: readonly DemoStudentRef[]): Promise<DemoStudentRef[]> {
  const cards = await prisma.reportCard.findMany({
    where: { schoolId: ref.schoolId, termId: ref.ganjilTermId, studentId: { in: targets.map((s) => s.id) } },
    select: { studentId: true, status: true, classId: true },
    take: targets.length,
  });
  const byStudent = new Map(cards.map((card) => [card.studentId, card]));
  return targets.filter((s) => {
    const card = byStudent.get(s.id);
    return !card || (card.status === "DRAFT" && card.classId === classId);
  });
}

async function gradeAndPublish(ref: DemoSchoolRef, classId: string, pending: readonly DemoStudentRef[], now: Date): Promise<void> {
  const ctx = adminContext(ref, now);
  const subjects = await loadMappedSubjects(prisma, classId);
  for (const [subjectIndex, subject] of subjects.entries()) {
    const entries = pending.map((s) => {
      const score = demoScore(s.index, subjectIndex);
      return { studentId: s.id, score, description: demoGradeDescription(score, subject.kkm) };
    });
    await upsertClassGrades(ctx, undefined, bulkGradesBody.parse({ termId: ref.ganjilTermId, classId, subjectId: subject.subjectId, entries }));
  }
  await publishReportCards(ctx, undefined, publishBody.parse({ termId: ref.ganjilTermId, classId, studentIds: pending.map((s) => s.id) }));
}

/** Pastikan rapor Semester Ganjil kelas pertama lengkap & terbit untuk siswa demo aktifnya. */
export async function ensureDemoReportCards(ref: DemoSchoolRef, spec: DemoSchoolSpec, now: Date, warnings: string[]): Promise<DemoReportCardSummary> {
  const className = spec.classes[DEMO_REPORT_CLASS_INDEX]?.name ?? "";
  const classId = ref.classIds.get(className);
  const targets = ref.students.filter((s) => s.className === className);
  if (!classId || targets.length === 0) return { className, published: 0 };
  const pending = await pendingReportTargets(ref, classId, targets);
  if (pending.length > 0) await collectDomainWarning(`rapor ${className}`, warnings, () => gradeAndPublish(ref, classId, pending, now));
  const published = await prisma.reportCard.count({
    where: { schoolId: ref.schoolId, termId: ref.ganjilTermId, classId, status: "PUBLISHED", studentId: { in: targets.map((s) => s.id) } },
  });
  return { className, published };
}

// ----------------------------------------------------------------------------- pengumuman

/** Id target dari nama kelas / urutan siswa demo; null bila target tidak ada lagi (mis. diubah di staging). */
function announcementInput(ref: DemoSchoolRef, plan: DemoAnnouncementPlan) {
  const classIds = plan.classNames.flatMap((name) => {
    const id = ref.classIds.get(name);
    return id ? [id] : [];
  });
  const studentIds = ref.students.filter((s) => plan.studentIndexes.includes(s.index)).map((s) => s.id);
  if (plan.audience === "CLASSES" && classIds.length === 0) return null;
  if (plan.audience === "STUDENTS" && studentIds.length === 0) return null;
  return createAnnouncementBody.parse({
    category: plan.category,
    title: plan.title,
    body: plan.body,
    audience: plan.audience,
    ...(plan.audience === "CLASSES" ? { classIds } : {}),
    ...(plan.audience === "STUDENTS" ? { studentIds } : {}),
    publishNow: true,
  });
}

/** Pastikan tiga pengumuman demo terbit; mengembalikan jumlah pengumuman demo berstatus PUBLISHED. */
export async function ensureDemoAnnouncements(ref: DemoSchoolRef, spec: DemoSchoolSpec, now: Date, warnings: string[]): Promise<number> {
  const plans = demoAnnouncementPlans(spec);
  const titles = plans.map((p) => p.title);
  const existing = await prisma.announcement.findMany({ where: { schoolId: ref.schoolId, title: { in: titles } }, select: { title: true }, take: 100 });
  const seen = new Set(existing.map((row) => row.title));
  for (const plan of plans.filter((p) => !seen.has(p.title))) {
    const input = announcementInput(ref, plan);
    if (!input) {
      warnings.push(`pengumuman "${plan.title}" dilewati: target demo tidak ditemukan`);
      continue;
    }
    await collectDomainWarning(`pengumuman "${plan.title}"`, warnings, async () => {
      await createAnnouncement(adminContext(ref, now), undefined, input);
    });
  }
  return prisma.announcement.count({ where: { schoolId: ref.schoolId, title: { in: titles }, status: "PUBLISHED" } });
}
