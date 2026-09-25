/**
 * Dataset demo `pnpm db:seed:demo` + penjaga murni (tanpa I/O, diuji unit).
 * Semua nilai deterministik agar seed idempoten (upsert berdasarkan kunci alami).
 * P3: tarif SPP per sekolah di sini; tagihan, rapor, dan pengumuman demo di demo-billing.ts,
 * demo-academic.ts, dan demo-announcements.ts. Fase berikutnya menambah sponsor dan iklan.
 */
import type { Gender, SchoolTimezone, Semester } from "@prisma/client";
import { checkPasswordPolicy, PASSWORD_VIOLATION_MESSAGES } from "../../src/lib/auth/password";
import type { ThemePresetKey } from "../../src/lib/schools/theme-store-rules";
import type { LocalDate } from "../../src/lib/time/zone";
import { parseDatabaseUrl } from "../deploy/db-url";

export interface DemoClassSpec {
  readonly name: string;
  readonly gradeLevel: number;
}

export interface DemoSubjectSpec {
  readonly code: string;
  readonly name: string;
}

export interface DemoStudentSpec {
  readonly nisn: string;
  readonly nis: string;
  readonly name: string;
  readonly gender: Gender;
  readonly birthPlace: string;
  readonly birthDate: LocalDate;
  readonly address: string;
  readonly guardianName: string;
  readonly guardianPhone: string;
  readonly className: string;
}

export interface DemoSchoolSpec {
  readonly npsn: string;
  readonly name: string;
  readonly slug: string;
  readonly address: string;
  readonly provinceCode: string;
  readonly cityCode: string;
  readonly latitude: string;
  readonly longitude: string;
  readonly geofenceRadiusM: number;
  readonly timezone: SchoolTimezone;
  readonly bank: { readonly bankName: string; readonly bankAccountNumber: string; readonly bankAccountHolder: string };
  /** Tarif SPP bulanan demo (rupiah); dipakai seed tagihan (scripts/lib/demo-billing.ts). */
  readonly sppAmount: number;
  /** Preset tema awal; diisi seed HANYA bila tema sekolah belum pernah diatur (tanpa = tema bawaan). */
  readonly themePreset?: ThemePresetKey;
  readonly adminName: string;
  readonly classes: readonly DemoClassSpec[];
  readonly subjects: readonly DemoSubjectSpec[];
  readonly students: readonly DemoStudentSpec[];
}

export interface DemoTermSpec {
  readonly semester: Semester;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate;
  readonly active: boolean;
}

export const DEMO_KKM = 75;
export const DEMO_STUDENTS_PER_SCHOOL = 15;
/** Instant aktivasi tetap (awal semester Ganjil) agar siswa demo lolos aturan "akun baru < 7 hari". */
export const DEMO_ACTIVATED_AT = new Date("2026-07-13T00:00:00.000Z");
export const DEMO_EMAIL_DOMAIN = "demo.studenthub.id";
export const DEMO_SUPER_ADMIN = { email: `superadmin@${DEMO_EMAIL_DOMAIN}`, name: "Super Admin Demo" } as const;

export const DEMO_ACADEMIC_YEAR: {
  readonly name: string;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate;
  readonly terms: readonly DemoTermSpec[];
} = {
  name: "2026/2027",
  startDate: "2026-07-13",
  endDate: "2027-06-26",
  terms: [
    { semester: "GANJIL", startDate: "2026-07-13", endDate: "2026-12-19", active: true },
    { semester: "GENAP", startDate: "2027-01-04", endDate: "2027-06-26", active: false },
  ],
};

/** [nama, gender, nama wali] — 15 siswa per sekolah. */
type RosterEntry = readonly [string, Gender, string];

const SMP_ROSTER: readonly RosterEntry[] = [
  ["Aditya Pratama", "MALE", "Budi Pratama"],
  ["Alya Putri Rahmawati", "FEMALE", "Siti Rahmawati"],
  ["Bima Saputra", "MALE", "Joko Saputra"],
  ["Citra Lestari", "FEMALE", "Dewi Lestari"],
  ["Dimas Ardiansyah", "MALE", "Hendra Ardiansyah"],
  ["Eka Nur Aisyah", "FEMALE", "Nur Hasanah"],
  ["Fajar Nugroho", "MALE", "Agus Nugroho"],
  ["Gita Permata Sari", "FEMALE", "Rina Permata"],
  ["Hafiz Maulana", "MALE", "Ahmad Maulana"],
  ["Intan Kusuma Wardani", "FEMALE", "Wati Kusuma"],
  ["Jaka Firmansyah", "MALE", "Dedi Firmansyah"],
  ["Kirana Ayu Lestari", "FEMALE", "Yuni Lestari"],
  ["Luthfi Hakim", "MALE", "Rahmat Hakim"],
  ["Maya Anggraini", "FEMALE", "Sri Anggraini"],
  ["Naufal Rizky Ramadhan", "MALE", "Rudi Ramadhan"],
];

const SMA_ROSTER: readonly RosterEntry[] = [
  ["Yohanes Wenda", "MALE", "Markus Wenda"],
  ["Maria Kogoya", "FEMALE", "Yosina Kogoya"],
  ["Daniel Rumbiak", "MALE", "Petrus Rumbiak"],
  ["Ester Mandowen", "FEMALE", "Lince Mandowen"],
  ["Samuel Waromi", "MALE", "Yakob Waromi"],
  ["Grace Sanggenafa", "FEMALE", "Agustina Sanggenafa"],
  ["Kevin Rumaropen", "MALE", "Frans Rumaropen"],
  ["Natalia Ayomi", "FEMALE", "Martha Ayomi"],
  ["Rizal Hamid", "MALE", "Abdul Hamid"],
  ["Sarah Wanggai", "FEMALE", "Obeth Wanggai"],
  ["Timotius Yoku", "MALE", "Hans Yoku"],
  ["Veronika Kambu", "FEMALE", "Selfina Kambu"],
  ["Wahyu Setiawan", "MALE", "Bambang Setiawan"],
  ["Yuliana Rumbewas", "FEMALE", "Yance Rumbewas"],
  ["Zakharia Mirino", "MALE", "Elias Mirino"],
];

interface RosterContext {
  readonly schoolIndex: number;
  readonly classes: readonly DemoClassSpec[];
  readonly birthYear: number;
  readonly birthPlaces: readonly string[];
  readonly street: string;
  readonly city: string;
}

const pad = (value: number, size: number): string => String(value).padStart(size, "0");

/** Siswa ke-i: NISN 99000000xx (unik lintas sekolah), NIS per sekolah, kelas bergilir. */
function toStudent(entry: RosterEntry, i: number, ctx: RosterContext): DemoStudentSpec {
  const [name, gender, guardianName] = entry;
  const globalIndex = ctx.schoolIndex * DEMO_STUDENTS_PER_SCHOOL + i + 1;
  return {
    nisn: `99000000${pad(globalIndex, 2)}`,
    nis: `2026${pad(i + 1, 3)}`,
    name,
    gender,
    birthPlace: ctx.birthPlaces[i % ctx.birthPlaces.length] ?? ctx.city,
    birthDate: `${ctx.birthYear + (i % 2)}-${pad((i % 12) + 1, 2)}-${pad(((i * 7) % 28) + 1, 2)}`,
    address: `${ctx.street} No. ${i + 1}, ${ctx.city}`,
    guardianName,
    guardianPhone: `+628121${ctx.schoolIndex}${pad(i + 1, 6)}`,
    className: ctx.classes[i % ctx.classes.length]?.name ?? "",
  };
}

const SMP_CLASSES: readonly DemoClassSpec[] = [
  { name: "VII-A", gradeLevel: 7 },
  { name: "VII-B", gradeLevel: 7 },
  { name: "VIII-A", gradeLevel: 8 },
];

const SMA_CLASSES: readonly DemoClassSpec[] = [
  { name: "X-1", gradeLevel: 10 },
  { name: "X-2", gradeLevel: 10 },
  { name: "XI-1", gradeLevel: 11 },
];

const SMP_SCHOOL: DemoSchoolSpec = {
  npsn: "99990001",
  name: "SMP Negeri 1 Harapan Jaya (Demo)",
  slug: "smpn1-harapan-jaya",
  address: "Jl. Asia Afrika No. 1, Kota Bandung, Jawa Barat",
  provinceCode: "32",
  cityCode: "32.73",
  latitude: "-6.9175",
  longitude: "107.6191",
  geofenceRadiusM: 150,
  timezone: "WIB",
  bank: { bankName: "Bank BJB", bankAccountNumber: "0099001122334", bankAccountHolder: "SMP Negeri 1 Harapan Jaya" },
  sppAmount: 250_000,
  adminName: "Admin SMPN 1 Harapan Jaya",
  classes: SMP_CLASSES,
  subjects: [
    { code: "MTK", name: "Matematika" },
    { code: "BIND", name: "Bahasa Indonesia" },
    { code: "BING", name: "Bahasa Inggris" },
    { code: "IPA", name: "Ilmu Pengetahuan Alam" },
    { code: "IPS", name: "Ilmu Pengetahuan Sosial" },
    { code: "PPKN", name: "Pendidikan Pancasila" },
  ],
  students: SMP_ROSTER.map((entry, i) =>
    toStudent(entry, i, {
      schoolIndex: 0,
      classes: SMP_CLASSES,
      birthYear: 2012,
      birthPlaces: ["Bandung", "Cimahi", "Garut", "Sumedang", "Bogor"],
      street: "Jl. Merdeka",
      city: "Kota Bandung",
    }),
  ),
};

const SMA_SCHOOL: DemoSchoolSpec = {
  npsn: "99990002",
  name: "SMA Demo Nusantara Timur",
  slug: "sma-nusantara-timur",
  address: "Jl. Percetakan Negara No. 10, Kota Jayapura, Papua",
  provinceCode: "91",
  cityCode: "91.71",
  latitude: "-2.5337",
  longitude: "140.7181",
  geofenceRadiusM: 150,
  timezone: "WIT",
  bank: { bankName: "Bank Papua", bankAccountNumber: "0099005566778", bankAccountHolder: "SMA Demo Nusantara Timur" },
  sppAmount: 350_000,
  themePreset: "madani",
  adminName: "Admin SMA Nusantara Timur",
  classes: SMA_CLASSES,
  subjects: [
    { code: "MTK", name: "Matematika" },
    { code: "BIND", name: "Bahasa Indonesia" },
    { code: "BING", name: "Bahasa Inggris" },
    { code: "FIS", name: "Fisika" },
    { code: "KIM", name: "Kimia" },
    { code: "BIO", name: "Biologi" },
  ],
  students: SMA_ROSTER.map((entry, i) =>
    toStudent(entry, i, {
      schoolIndex: 1,
      classes: SMA_CLASSES,
      birthYear: 2009,
      birthPlaces: ["Jayapura", "Sentani", "Biak", "Merauke", "Wamena"],
      street: "Jl. Raya Abepura",
      city: "Kota Jayapura",
    }),
  ),
};

export const DEMO_SCHOOLS: readonly DemoSchoolSpec[] = [SMP_SCHOOL, SMA_SCHOOL];

export function demoAdminEmail(school: Pick<DemoSchoolSpec, "slug">): string {
  return `admin@${school.slug}.${DEMO_EMAIL_DOMAIN}`;
}

// ----------------------------------------------------------------------------- penjaga

export type SeedGuardResult =
  | { readonly ok: true; readonly database: string; readonly host: string }
  | { readonly ok: false; readonly reason: string };

/** Seed demo hanya untuk database non-produksi: nama berakhiran _staging, _dev, atau _test. */
const SEEDABLE_DB_NAME = /_(staging|dev|test)$/;

/** Validasi DATABASE_URL untuk seed demo. Pesan penolakan tidak pernah memuat user/password. */
export function checkSeedDatabaseUrl(raw: string | undefined): SeedGuardResult {
  if (raw === undefined || raw.trim() === "") return { ok: false, reason: "DATABASE_URL belum diisi." };
  let database: string;
  let host: string;
  try {
    const conn = parseDatabaseUrl(raw.trim());
    database = conn.database;
    host = `${conn.host}:${conn.port}`;
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "DATABASE_URL tidak valid." };
  }
  if (!SEEDABLE_DB_NAME.test(database)) {
    return { ok: false, reason: `database "${database}" bukan database demo: nama wajib berakhiran _staging, _dev, atau _test.` };
  }
  return { ok: true, database, host };
}

/** Kata sandi demo dari env DEMO_PASSWORD: kebijakan kata sandi aplikasi (>= 8, huruf + angka, dst.). */
export function checkDemoPassword(raw: string | undefined): string[] {
  if (raw === undefined || raw === "") return ["DEMO_PASSWORD belum diisi."];
  return checkPasswordPolicy(raw).map((violation) => PASSWORD_VIOLATION_MESSAGES[violation]);
}
