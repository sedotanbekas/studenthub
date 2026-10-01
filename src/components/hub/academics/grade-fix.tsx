"use client";
import { gradeIssue } from "@/lib/frontend/academics-rules";
import { EDUCATION_LEVEL_LABELS, gradeLabel, gradeSpan } from "@/lib/schools/education-level";
import { Icon } from "../icon";
import { useAcademics, useSaving } from "./use-academics";

/**
 * Kelas yang tingkatnya di luar jenjang (mis. SMK mengisi "3" untuk kelas 12): satu kalimat sebab + tombol
 * perbaikan tepat di sebelahnya. Hanya kelas yang maksudnya bisa ditebak yang diperbaiki otomatis.
 */
export function GradeFixBanner({ yearId }: { yearId?: string }) {
  const { data, mutate, reload, toast, canManage } = useAcademics();
  const saving = useSaving();
  const level = data.school.educationLevel;
  if (!level) return null;
  const issues = data.classes.filter((c) => !yearId || c.academicYearId === yearId).flatMap((cls) => {
    const issue = gradeIssue(level, cls);
    return issue ? [{ cls, issue }] : [];
  });
  if (issues.length === 0) return null;
  const fixable = issues.filter(({ issue }) => issue.fixTo !== null);
  const { first, last } = gradeSpan(level);
  const names = issues.map(({ cls }) => cls.name).join(", ");
  const sameFix = fixable.length > 0 && fixable.every(({ issue, cls }) => issue.fixTo === fixable[0]!.issue.fixTo && cls.gradeLevel === fixable[0]!.cls.gradeLevel);
  const fixAll = () => saving.run(async () => {
    try {
      for (const { cls, issue } of fixable) await mutate(`/school/classes/${cls.id}`, "PATCH", { gradeLevel: issue.fixTo });
    } finally {
      await reload().catch(() => undefined);
    }
    toast(`${fixable.length} kelas diperbaiki.`);
  });
  const action = sameFix ? `Ubah jadi ${gradeLabel(level, fixable[0]!.issue.fixTo!).toLowerCase()}` : `Perbaiki ${fixable.length} kelas`;
  return <div className="warning-message acad-inline-notice" role="status">
    <Icon name="help" size={18} />
    <span className="notice-text"><strong>{issues.length} kelas tingkatnya di luar jenjang {EDUCATION_LEVEL_LABELS[level]}.</strong> {names} tersimpan di luar kelas {first}–{last}, jadi tidak cocok untuk rapor dan kenaikan kelas.</span>
    {canManage && fixable.length > 0 && <button type="button" className="button secondary small-button" disabled={saving.busy} onClick={fixAll}>{saving.busy ? "Memperbaiki…" : action}</button>}
    {saving.error && <span className="field-error notice-error">{saving.error}</span>}
  </div>;
}
