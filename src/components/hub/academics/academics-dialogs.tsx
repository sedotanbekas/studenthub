"use client";
import type { SemesterCode } from "@/lib/academics/rules";
import { SEMESTER_NAMES, type ClassView, type SubjectView, type TermView, type YearView } from "@/lib/frontend/academics-rules";
import { ClassForm, ClassSubjectsForm, LevelForm, SubjectForm } from "./class-subject-forms";
import { Modal } from "./form-kit";
import { TermForm, YearForm } from "./year-term-forms";

/** Dialog yang sedang terbuka di tampilan tab. Judul selalu menyebut objeknya (bukan "Tambah baru"). */
export type DialogState =
  | { readonly kind: "year"; readonly year?: YearView }
  | { readonly kind: "term"; readonly year: YearView; readonly term?: TermView; readonly semester?: SemesterCode }
  | { readonly kind: "class"; readonly cls?: ClassView; readonly yearId?: string }
  | { readonly kind: "subjects"; readonly cls: ClassView }
  | { readonly kind: "subject"; readonly subject?: SubjectView }
  | { readonly kind: "level" };

function titleOf(dialog: DialogState): string {
  switch (dialog.kind) {
    case "year": return dialog.year ? `Ubah tahun ajaran ${dialog.year.name}` : "Tahun ajaran baru";
    case "term": return dialog.term ? `Ubah ${dialog.term.label}` : `${dialog.semester ? SEMESTER_NAMES[dialog.semester] : "Semester"} baru · ${dialog.year.name}`;
    case "class": return dialog.cls ? `Ubah kelas ${dialog.cls.name}` : "Kelas baru";
    case "subjects": return `Mapel kelas ${dialog.cls.name}`;
    case "subject": return dialog.subject ? `Ubah mapel ${dialog.subject.name}` : "Mata pelajaran baru";
    case "level": return "Jenjang sekolah";
  }
}

export function AcademicsDialog({ dialog, onClose }: { dialog: DialogState; onClose: () => void }) {
  const common = { variant: "dialog" as const, onDone: onClose, onCancel: onClose };
  return <Modal eyebrow="Akademik" title={titleOf(dialog)} onClose={onClose}>
    {dialog.kind === "year" && <YearForm {...common} year={dialog.year} />}
    {dialog.kind === "term" && <TermForm {...common} year={dialog.year} term={dialog.term} semester={dialog.semester} />}
    {dialog.kind === "class" && <ClassForm {...common} cls={dialog.cls} yearId={dialog.yearId} />}
    {dialog.kind === "subjects" && <ClassSubjectsForm cls={dialog.cls} onDone={onClose} onCancel={onClose} />}
    {dialog.kind === "subject" && <SubjectForm {...common} subject={dialog.subject} />}
    {dialog.kind === "level" && <LevelForm {...common} />}
  </Modal>;
}
