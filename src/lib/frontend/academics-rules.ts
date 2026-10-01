import { parseAcademicYearName, type SemesterCode } from "@/lib/academics/rules";
import type { DateRange } from "@/lib/calendar/ranges";
import { termCoverageSealDate } from "@/lib/calendar/rules";
import { EDUCATION_LEVEL_LABELS, EDUCATION_LEVEL_NAMES, gradeLabel, gradeSpan, isGradeInLevel, suggestGradeFix, type EducationLevel } from "@/lib/schools/education-level";
import { addDays, formatMinute, localParts, type LocalDate, type SchoolTz } from "@/lib/time/zone";

/**
 * Aturan murni halaman Akademik (wizard + tab): saran isian, batas tanggal, status langkah persiapan,
 * dan kalimat sebab-akibat singkat untuk admin sekolah. Tanpa React; diuji dengan node:test.
 */
export interface TermView extends DateRange {
  readonly id: string;
  readonly academicYearId: string;
  readonly semester: SemesterCode;
  readonly label: string;
  readonly isActive: boolean;
}

export interface YearView extends DateRange {
  readonly id: string;
  readonly name: string;
  readonly terms: readonly TermView[];
}

export interface ClassView {
  readonly id: string;
  readonly academicYearId: string;
  readonly academicYearName: string;
  readonly name: string;
  readonly gradeLevel: number;
  readonly isActive: boolean;
  readonly activeStudentCount: number;
  readonly subjectCount: number;
}

export interface SubjectView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kkm: number;
  readonly sortOrder: number;
  readonly isActive: boolean;
}

export interface AcademicSnapshot {
  readonly educationLevel: EducationLevel | null;
  readonly today: LocalDate;
  readonly years: readonly YearView[];
  readonly classes: readonly ClassView[];
  readonly subjects: readonly SubjectView[];
}

export const SEMESTERS: readonly SemesterCode[] = ["GANJIL", "GENAP"];
export const SEMESTER_NAMES: Readonly<Record<SemesterCode, string>> = { GANJIL: "Semester Ganjil", GENAP: "Semester Genap" };
/** Tahun ajaran di Indonesia umumnya dimulai Juli. */
const YEAR_START_MONTH = 7;

const DATE_FORMAT = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const dateText = (date: LocalDate): string => DATE_FORMAT.format(new Date(`${date}T00:00:00Z`));
export const dateRangeText = (start: LocalDate, end: LocalDate): string => `${dateText(start)} – ${dateText(end)}`;

const covers = (range: DateRange, date: LocalDate): boolean => range.startDate <= date && date <= range.endDate;
const earlier = (a: LocalDate, b: LocalDate): LocalDate => (a < b ? a : b);
const later = (a: LocalDate, b: LocalDate): LocalDate => (a > b ? a : b);

export function suggestYearName(today: LocalDate): string {
  const year = Number(today.slice(0, 4));
  const startYear = Number(today.slice(5, 7)) >= YEAR_START_MONTH ? year : year - 1;
  return `${startYear}/${startYear + 1}`;
}

export function suggestYearRange(name: string): DateRange | null {
  const parsed = parseAcademicYearName(name.trim());
  return parsed ? { startDate: `${parsed.startYear}-07-01`, endDate: `${parsed.startYear + 1}-06-30` } : null;
}

/** Rentang yang boleh dipilih untuk semester: di dalam tahun ajaran dan tidak menabrak semester pasangannya. */
export function termBounds(year: YearView, semester: SemesterCode): { min: LocalDate; max: LocalDate } {
  const sibling = year.terms.find((term) => term.semester !== semester);
  if (semester === "GANJIL") return { min: year.startDate, max: sibling ? addDays(sibling.startDate, -1) : year.endDate };
  return { min: sibling ? addDays(sibling.endDate, 1) : year.startDate, max: year.endDate };
}

/** Ganjil: awal tahun ajaran s.d. akhir Desember; Genap: Januari s.d. akhir tahun ajaran (dalam batas). */
export function suggestTermRange(year: YearView, semester: SemesterCode): DateRange {
  const { min, max } = termBounds(year, semester);
  const startYear = parseAcademicYearName(year.name)?.startYear ?? Number(year.startDate.slice(0, 4));
  const range = semester === "GANJIL" ? { startDate: min, endDate: earlier(max, `${startYear}-12-31`) } : { startDate: later(min, `${startYear + 1}-01-01`), endDate: max };
  return range.startDate <= range.endDate ? range : { startDate: min, endDate: max };
}

export const missingSemesters = (year: YearView): SemesterCode[] => SEMESTERS.filter((semester) => !year.terms.some((term) => term.semester === semester));

/** Semester berikutnya untuk dibuat: yang belum ada, utamakan yang sarannya mencakup hari ini. null = lengkap. */
export function preferredSemester(year: YearView, today: LocalDate): SemesterCode | null {
  const missing = missingSemesters(year);
  return missing.find((semester) => covers(suggestTermRange(year, semester), today)) ?? missing[0] ?? null;
}

export function termCovering(years: readonly YearView[], date: LocalDate): TermView | null {
  return years.flatMap((year) => year.terms).find((term) => covers(term, date)) ?? null;
}

function nextTerm(years: readonly YearView[], date: LocalDate): TermView | null {
  const upcoming = years.flatMap((year) => year.terms).filter((term) => term.startDate > date);
  return upcoming.sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null;
}

/** Tahun ajaran yang sedang/akan dikelola: mencakup hari ini -> terdekat yang akan datang -> yang terakhir. */
export function currentYear(years: readonly YearView[], today: LocalDate): YearView | null {
  const covering = years.find((year) => covers(year, today));
  if (covering) return covering;
  const byStart = [...years].sort((a, b) => a.startDate.localeCompare(b.startDate));
  return byStart.find((year) => year.startDate > today) ?? byStart.at(-1) ?? null;
}

export type StepKey = "level" | "year" | "term" | "class" | "subject";
export type StepStatus = "done" | "todo" | "optional";

export interface SetupStep {
  readonly key: StepKey;
  readonly title: string;
  /** Satu kalimat: kenapa langkah ini perlu / akibat bila dilewati. */
  readonly why: string;
  readonly status: StepStatus;
  readonly summary: string;
}

function termStep(snapshot: AcademicSnapshot): SetupStep {
  const covering = termCovering(snapshot.years, snapshot.today);
  const upcoming = covering ? null : nextTerm(snapshot.years, snapshot.today);
  const summary = covering ? `${covering.label} · ${dateRangeText(covering.startDate, covering.endDate)}` : upcoming ? `${upcoming.label} mulai ${dateText(upcoming.startDate)}` : "Belum ada semester untuk hari ini";
  return { key: "term", title: "Semester", why: "Siswa hanya bisa absen pada tanggal yang masuk semester.", status: covering || upcoming ? "done" : "todo", summary };
}

export function setupSteps(snapshot: AcademicSnapshot): SetupStep[] {
  const { educationLevel: level } = snapshot;
  const year = currentYear(snapshot.years, snapshot.today);
  const usableYear = year && year.endDate >= snapshot.today ? year : null;
  const classCount = usableYear ? snapshot.classes.filter((c) => c.academicYearId === usableYear.id && c.isActive).length : 0;
  const subjectCount = snapshot.subjects.filter((s) => s.isActive).length;
  return [
    { key: "level", title: "Jenjang sekolah", why: "Menentukan pilihan tingkat kelas, mis. SMK: tingkat 1–3 = kelas 10–12.", status: level ? "done" : "todo", summary: level ? `${EDUCATION_LEVEL_LABELS[level]} · ${EDUCATION_LEVEL_NAMES[level]}` : "Belum diisi" },
    { key: "year", title: "Tahun ajaran", why: "Wadah semester dan kelas; setiap kelas milik satu tahun ajaran.", status: usableYear ? "done" : "todo", summary: usableYear ? `${usableYear.name} · ${dateRangeText(usableYear.startDate, usableYear.endDate)}` : "Belum ada tahun ajaran berjalan" },
    termStep(snapshot),
    { key: "class", title: "Kelas", why: "Siswa hanya bisa diaktifkan bila sudah ditempatkan di kelas.", status: classCount > 0 ? "done" : "todo", summary: usableYear ? `${classCount} kelas aktif di ${usableYear.name}` : "Buat tahun ajaran dulu" },
    { key: "subject", title: "Mata pelajaran", why: "Opsional untuk absensi; dibutuhkan untuk nilai dan rapor.", status: subjectCount > 0 ? "done" : "optional", summary: subjectCount > 0 ? `${subjectCount} mapel aktif` : "Belum ada mapel" },
  ];
}

export const isSetupComplete = (steps: readonly SetupStep[]): boolean => steps.every((step) => step.status !== "todo");

export interface Notice {
  readonly tone: "warning" | "info";
  readonly text: string;
}

/** Sebab-akibat semester untuk hari ini (null = hari ini tercakup semester, absensi berjalan). */
export function todayTermNotice(snapshot: Pick<AcademicSnapshot, "years" | "today">): Notice | null {
  if (termCovering(snapshot.years, snapshot.today)) return null;
  const upcoming = nextTerm(snapshot.years, snapshot.today);
  if (upcoming) return { tone: "info", text: `${upcoming.label} mulai ${dateText(upcoming.startDate)}. Sampai tanggal itu siswa belum bisa absen.` };
  return { tone: "warning", text: "Belum ada semester untuk hari ini, jadi siswa belum bisa absen." };
}

/** Versi ringkas untuk Beranda (dari setupChecklist GET /school/profile, tanpa memuat daftar semester). */
export function checklistTermNotice(checklist: { hasTermToday: boolean; nextTermStartDate: LocalDate | null }): Notice | null {
  if (checklist.hasTermToday) return null;
  if (checklist.nextTermStartDate) return { tone: "info", text: `Semester berikutnya mulai ${dateText(checklist.nextTermStartDate)}. Sampai tanggal itu siswa belum bisa absen.` };
  return { tone: "warning", text: "Belum ada semester untuk hari ini, jadi siswa belum bisa absen." };
}

/** Kalimat untuk formulir semester bila menyimpan akan menyegel hari ini (server: sealTodayForTermChange). */
export function termSealNotice(input: { before: DateRange | null; after: DateRange; now: Date; timezone: SchoolTz; checkInCloseMinute: number }): string | null {
  const local = localParts(input.now, input.timezone);
  const sealed = termCoverageSealDate({ today: local.ymd, minuteOfDay: local.minuteOfDay, checkInCloseMinute: input.checkInCloseMinute, before: input.before, after: input.after });
  if (!sealed) return null;
  return `Absen hari ini sudah ditutup pukul ${formatMinute(input.checkInCloseMinute)}, jadi hari ini tidak dihitung dan siswa tidak ditandai alpa. Absensi berlaku mulai besok.`;
}

export interface GradeIssue {
  /** Kelas nasional yang kemungkinan dimaksud (null = tidak bisa ditebak, admin memilih sendiri). */
  readonly fixTo: number | null;
  readonly text: string;
}

/** Kelas yang tersimpan di luar jenjang sekolah (mis. SMK mengisi "3" untuk kelas 12). */
export function gradeIssue(level: EducationLevel | null, cls: Pick<ClassView, "gradeLevel">): GradeIssue | null {
  if (level === null || isGradeInLevel(level, cls.gradeLevel)) return null;
  const { first, last } = gradeSpan(level);
  const fixTo = suggestGradeFix(level, cls.gradeLevel);
  const head = `Tersimpan sebagai kelas ${cls.gradeLevel}, padahal jenjang ${EDUCATION_LEVEL_LABELS[level]} hanya kelas ${first}–${last}.`;
  return { fixTo, text: fixTo === null ? `${head} Ubah tingkatnya.` : `${head} Maksudnya ${gradeLabel(level, fixTo).toLowerCase()}?` };
}
