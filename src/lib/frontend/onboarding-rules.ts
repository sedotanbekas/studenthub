import { DEFAULT_SCHOOL_CONFIG, schoolDayCodes } from "@/lib/schools/rules";
import type { EducationLevel } from "@/lib/schools/education-level";

/**
 * Daftar persiapan di Beranda (murni): sekolah baru dan sponsor baru melihat langkah berurutan beserta satu
 * kalimat kenapa langkah itu perlu dan tombol yang langsung membuka tempatnya. Kartu hilang bila langkah wajib
 * sudah selesai.
 */
export type ChecklistStatus = "done" | "todo" | "optional" | "waiting";

export interface ChecklistStep {
  readonly key: string;
  readonly title: string;
  readonly why: string;
  readonly status: ChecklistStatus;
  readonly summary: string;
  /** null = tidak bisa dikerjakan pengguna ini (mis. rekening diatur super admin). */
  readonly href: string | null;
  readonly cta: string;
}

/** Selesai bila tidak ada langkah wajib yang masih harus dikerjakan atau sedang menunggu. */
export const checklistComplete = (steps: readonly ChecklistStep[]): boolean => steps.every((step) => step.status === "done" || step.status === "optional");

export interface SchoolSetupFacts {
  readonly educationLevel: EducationLevel | null;
  readonly checkInOpenMinute: number;
  readonly startMinute: number;
  readonly lateToleranceMinutes: number;
  readonly checkInCloseMinute: number;
  readonly dayEndMinute: number;
  readonly schoolDaysMask: number;
  readonly bankName: string | null;
  readonly schedule: { readonly checkInOpen: string; readonly checkInClose: string };
  readonly setupChecklist: {
    readonly hasTermToday: boolean;
    readonly nextTermStartDate: string | null;
    readonly classCount: number;
    readonly subjectCount: number;
    readonly activeStudentCount: number;
    readonly holidayCount: number;
  };
}

const DAY_SHORT: Readonly<Record<string, string>> = { MON: "Sen", TUE: "Sel", WED: "Rab", THU: "Kam", FRI: "Jum", SAT: "Sab", SUN: "Min" };
const SCHEDULE_KEYS = ["checkInOpenMinute", "startMinute", "lateToleranceMinutes", "checkInCloseMinute", "dayEndMinute", "schoolDaysMask"] as const;

const COUNT_KEYS = ["classCount", "subjectCount", "activeStudentCount", "holidayCount"] as const;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Penjaga bentuk respons /school/profile: panel pelengkap Beranda diam saja bila datanya asing, bukan merobohkan halaman. */
export function isSchoolSetupFacts(value: unknown): value is SchoolSetupFacts {
  if (!isRecord(value) || !isRecord(value.setupChecklist) || !isRecord(value.schedule)) return false;
  const checklist = value.setupChecklist;
  return typeof checklist.hasTermToday === "boolean"
    && COUNT_KEYS.every((key) => typeof checklist[key] === "number")
    && SCHEDULE_KEYS.every((key) => typeof value[key] === "number")
    && typeof value.schedule.checkInOpen === "string" && typeof value.schedule.checkInClose === "string";
}

const isDefaultSchedule =(facts: SchoolSetupFacts): boolean => SCHEDULE_KEYS.every((key) => facts[key] === DEFAULT_SCHOOL_CONFIG[key]);
const dayList = (mask: number): string => schoolDayCodes(mask).map((code) => DAY_SHORT[code]).join(", ");

function academicsStep(facts: SchoolSetupFacts): ChecklistStep {
  const { setupChecklist: c } = facts;
  const missing = [!facts.educationLevel && "jenjang", !(c.hasTermToday || c.nextTermStartDate) && "semester", c.classCount === 0 && "kelas"].filter(Boolean);
  return {
    key: "academics", title: "Akademik", why: "Tanpa semester siswa tidak bisa absen; tanpa kelas siswa tidak bisa diaktifkan.",
    status: missing.length === 0 ? "done" : "todo", summary: missing.length === 0 ? `Jenjang, semester, dan ${c.classCount} kelas siap` : `Belum ada: ${missing.join(", ")}`,
    href: "/hub/academics", cta: "Buka panduan Akademik",
  };
}

export function schoolSetupSteps(facts: SchoolSetupFacts): ChecklistStep[] {
  const c = facts.setupChecklist;
  const defaultSchedule = isDefaultSchedule(facts);
  return [
    academicsStep(facts),
    {
      key: "schedule", title: "Jam & hari absensi", why: "Absen di luar jam buka–tutup ditolak; pastikan sesuai jam sekolahmu.",
      status: defaultSchedule ? "optional" : "done", summary: `${defaultSchedule ? "Masih bawaan: " : ""}${facts.schedule.checkInOpen}–${facts.schedule.checkInClose}, ${dayList(facts.schoolDaysMask)}`,
      href: "/hub/school-settings", cta: "Periksa jadwal",
    },
    {
      key: "students", title: "Data siswa", why: "Siswa baru bisa masuk dan absen setelah akunnya aktif.",
      status: c.activeStudentCount > 0 ? "done" : "todo", summary: c.activeStudentCount > 0 ? `${c.activeStudentCount} siswa aktif` : "Belum ada siswa aktif",
      href: "/hub/students", cta: "Tambah atau impor siswa",
    },
    {
      key: "holidays", title: "Libur sekolah", why: "Pada hari libur siswa tidak perlu absen dan tidak ditandai alpa.",
      status: c.holidayCount > 0 ? "done" : "optional", summary: c.holidayCount > 0 ? `${c.holidayCount} libur sekolah tercatat` : "Libur nasional sudah otomatis; libur sekolah belum ada",
      href: "/hub/calendar", cta: "Atur libur",
    },
    {
      key: "bank", title: "Rekening SPP", why: "Rekening tujuan transfer yang dilihat siswa saat membayar SPP.",
      status: facts.bankName ? "done" : "optional", summary: facts.bankName ? `Rekening ${facts.bankName} terpasang` : "Diatur oleh super admin studenthub.id",
      href: null, cta: "",
    },
  ];
}

export interface SponsorFacts {
  readonly status: "PENDING" | "APPROVED" | "SUSPENDED";
  readonly statusReason: string | null;
  readonly balance: number;
  readonly pendingTopUps: number;
  readonly adsCount: number;
  readonly liveCount: number;
}

function approvalStep(facts: SponsorFacts): ChecklistStep {
  const base = { key: "approval", title: "Persetujuan akun", why: "Kampanye hanya bisa tayang setelah akun sponsor disetujui.", href: "/hub/company", cta: "Lihat profil" };
  if (facts.status === "APPROVED") return { ...base, status: "done", summary: "Akun disetujui" };
  if (facts.status === "PENDING") return { ...base, status: "waiting", summary: "Sedang ditinjau tim studenthub.id" };
  return { ...base, status: "todo", summary: `Akun ditangguhkan${facts.statusReason ? `: ${facts.statusReason}` : ""}` };
}

export function sponsorOnboardingSteps(facts: SponsorFacts): ChecklistStep[] {
  const topUp: ChecklistStatus = facts.balance > 0 ? "done" : facts.pendingTopUps > 0 ? "waiting" : "todo";
  const live: ChecklistStatus = facts.liveCount > 0 ? "done" : facts.adsCount > 0 ? "waiting" : "todo";
  return [
    approvalStep(facts),
    {
      key: "topup", title: "Isi saldo", why: "Setiap klik iklan memotong saldo; tanpa saldo iklan berhenti tayang.", status: topUp,
      summary: topUp === "done" ? "Saldo tersedia" : topUp === "waiting" ? "Bukti top-up menunggu verifikasi" : "Saldo masih kosong", href: "/hub/balance", cta: "Isi saldo",
    },
    {
      key: "campaign", title: "Kampanye pertama", why: "Kampanye berisi banner, tautan, dan sasaran sekolah/wilayah.", status: facts.adsCount > 0 ? "done" : "todo",
      summary: facts.adsCount > 0 ? `${facts.adsCount} kampanye dibuat` : "Belum ada kampanye", href: "/hub/campaigns", cta: "Buat kampanye",
    },
    {
      key: "live", title: "Tayang", why: "Kampanye tayang setelah ditinjau tim studenthub.id dan saldo cukup.", status: live,
      summary: live === "done" ? `${facts.liveCount} kampanye tayang` : live === "waiting" ? "Menunggu tinjauan atau jadwal tayang" : "Belum ada kampanye", href: "/hub/campaigns", cta: "Lihat kampanye",
    },
  ];
}
