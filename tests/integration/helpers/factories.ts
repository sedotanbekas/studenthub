/**
 * Pabrik baris minimal yang valid terhadap SEMUA CHECK constraint migrasi init.
 * Setiap pemanggilan membuat data unik (uniq/NISN acak) sehingga test tidak perlu truncate dan
 * aman dijalankan berulang pada database yang sama.
 *
 * Kata sandi di-hash bcrypt cost 4 (cepat; hanya untuk test). Login test memakai DEFAULT_TEST_PASSWORD.
 */
import { randomBytes, randomInt } from "node:crypto";
import { hash } from "@node-rs/bcrypt";
import type {
  AcademicYear,
  FileKind,
  Prisma,
  School,
  SchoolClass,
  SchoolTimezone,
  Semester,
  Sponsor,
  SponsorStatus,
  StoredFile,
  Student,
  StudentStatus,
  Term,
  User,
} from "@prisma/client";
import { toDbDate, type LocalDate } from "../../../src/lib/time/zone";
import { prisma, uniq } from "./db";

/** Kata sandi semua akun hasil factory (memenuhi kebijakan: >= 8, huruf + angka). */
export const DEFAULT_TEST_PASSWORD = "Rahasia123";
const TEST_BCRYPT_COST = 4;
const DAY_MS = 86_400_000;
/** Siswa hasil factory dianggap aktif sejak 30 hari lalu (lolos aturan "akun baru < 7 hari"). */
const DEFAULT_ACTIVATED_DAYS_AGO = 30;
/** Status yang memegang activeNisn (= nisn); DRAFT & MOVED selalu NULL (chk_student_active_nisn). */
const NISN_HOLDING_STATUSES: readonly StudentStatus[] = ["ACTIVE", "INACTIVE", "GRADUATED"];

/** User tanpa kolom rahasia (di-omit global oleh src/lib/db.ts). */
export type TestUser = Omit<User, "passwordHash" | "totpSecretEnc">;

export interface CreateUserOptions {
  readonly name?: string;
  readonly email?: string;
  readonly password?: string;
  readonly isActive?: boolean;
  readonly mustChangePassword?: boolean;
}

const hashCache = new Map<string, Promise<string>>();

/** Hash bcrypt cost 4, di-cache per kata sandi dalam satu proses test. */
export function hashTestPassword(password: string = DEFAULT_TEST_PASSWORD): Promise<string> {
  const cached = hashCache.get(password);
  if (cached) return cached;
  const pending = hash(password, TEST_BCRYPT_COST);
  hashCache.set(password, pending);
  return pending;
}

/** Email unik yang lolos validasi format. */
export function uniqEmail(prefix = "user"): string {
  return `${uniq(prefix)}@studenthub.test`;
}

/** NISN 10 digit acak (tidak diawali 0). Peluang bentrok sangat kecil (ruang 9 x 10^9). */
export function uniqNisn(): string {
  return String(randomInt(1_000_000_000, 10_000_000_000));
}

async function userData(options: CreateUserOptions, defaultName: string) {
  return {
    name: options.name ?? `${defaultName} ${uniq("u")}`,
    passwordHash: await hashTestPassword(options.password),
    isActive: options.isActive ?? true,
    mustChangePassword: options.mustChangePassword ?? false,
  };
}

// ----------------------------------------------------------------------------- sekolah & akademik

export interface CreateSchoolOptions {
  readonly timezone?: SchoolTimezone;
  /** Default "32" (Jawa Barat). */
  readonly provinceCode?: string;
  /** Default "32.73" (Kota Bandung). */
  readonly cityCode?: string;
  /** Override kolom lain (jadwal, geofence, rekening, ...). Tetap harus lolos CHECK. */
  readonly data?: Partial<Prisma.SchoolUncheckedCreateInput>;
}

/** Sekolah aktif dengan jadwal default skema (06:00 buka, 07:00 masuk, 10:00 tutup, 15:00 akhir hari). */
export async function createSchool(options: CreateSchoolOptions = {}): Promise<School> {
  return prisma.school.create({
    data: {
      name: `Sekolah ${uniq("s")}`,
      provinceCode: options.provinceCode ?? "32",
      cityCode: options.cityCode ?? "32.73",
      latitude: "-6.9147000",
      longitude: "107.6098000",
      timezone: options.timezone ?? "WIB",
      ...options.data,
    },
  });
}

export interface CreateAcademicYearOptions {
  /** Jadikan semester ini School.activeTermId. Default true. */
  readonly active?: boolean;
  /** Default "2026/2027" (unik per sekolah). */
  readonly name?: string;
  readonly yearStart?: LocalDate;
  readonly yearEnd?: LocalDate;
  readonly semester?: Semester;
  readonly termStart?: LocalDate;
  readonly termEnd?: LocalDate;
}

export interface AcademicYearWithTerm {
  readonly academicYear: AcademicYear;
  readonly term: Term;
}

/** Tahun ajaran 2026/2027 + semester Ganjil (13 Jul - 19 Des 2026), default dijadikan aktif. */
export async function createAcademicYearWithTerm(
  schoolId: string,
  options: CreateAcademicYearOptions = {},
): Promise<AcademicYearWithTerm> {
  return prisma.$transaction(async (tx) => {
    const academicYear = await tx.academicYear.create({
      data: {
        schoolId,
        name: options.name ?? "2026/2027",
        startDate: toDbDate(options.yearStart ?? "2026-07-13"),
        endDate: toDbDate(options.yearEnd ?? "2027-06-26"),
      },
    });
    const term = await tx.term.create({
      data: {
        schoolId,
        academicYearId: academicYear.id,
        semester: options.semester ?? "GANJIL",
        startDate: toDbDate(options.termStart ?? "2026-07-13"),
        endDate: toDbDate(options.termEnd ?? "2026-12-19"),
      },
    });
    if (options.active ?? true) {
      await tx.school.update({ where: { id: schoolId }, data: { activeTermId: term.id } });
    }
    return { academicYear, term };
  });
}

export interface CreateClassOptions {
  readonly name?: string;
  /** 1 s.d. 12 (chk_class_grade_level). Default 7. */
  readonly gradeLevel?: number;
  readonly isActive?: boolean;
}

export async function createClass(
  schoolId: string,
  academicYearId: string,
  options: CreateClassOptions = {},
): Promise<SchoolClass> {
  return prisma.schoolClass.create({
    data: {
      schoolId,
      academicYearId,
      name: options.name ?? uniq("VII"),
      gradeLevel: options.gradeLevel ?? 7,
      isActive: options.isActive ?? true,
    },
  });
}

// ----------------------------------------------------------------------------- akun staf

export async function createSuperAdmin(options: CreateUserOptions = {}): Promise<TestUser> {
  return prisma.user.create({
    data: { ...(await userData(options, "Super Admin")), role: "SUPER_ADMIN", email: options.email ?? uniqEmail("sa") },
  });
}

export async function createSchoolAdmin(schoolId: string, options: CreateUserOptions = {}): Promise<TestUser> {
  return prisma.user.create({
    data: {
      ...(await userData(options, "Admin Sekolah")),
      role: "SCHOOL_ADMIN",
      email: options.email ?? uniqEmail("adm"),
      schoolId,
    },
  });
}

// ----------------------------------------------------------------------------- siswa

export interface CreateStudentOptions extends Omit<CreateUserOptions, "email"> {
  /** Default ACTIVE. */
  readonly status?: StudentStatus;
  readonly classId?: string | null;
  readonly nisn?: string;
  readonly nis?: string;
  /** Default 30 hari lalu untuk status selain DRAFT; DRAFT selalu NULL kecuali diisi. */
  readonly activatedAt?: Date | null;
  /** Override kolom Student lain (biodata, sppAmount, perangkat terikat, ...). */
  readonly data?: Partial<Omit<Prisma.StudentUncheckedCreateWithoutUserInput, "schoolId">>;
}

export interface TestStudent {
  readonly user: TestUser;
  readonly student: Student;
}

function studentData(schoolId: string, options: CreateStudentOptions) {
  const status = options.status ?? "ACTIVE";
  const nisn = options.nisn ?? uniqNisn();
  const defaultActivatedAt = status === "DRAFT" ? null : new Date(Date.now() - DEFAULT_ACTIVATED_DAYS_AGO * DAY_MS);
  return {
    schoolId,
    nisn,
    activeNisn: NISN_HOLDING_STATUSES.includes(status) ? nisn : null,
    nis: options.nis ?? uniq("n"),
    gender: "MALE" as const,
    birthPlace: "Bandung",
    birthDate: toDbDate("2012-05-17"),
    address: "Jl. Contoh No. 1, Bandung",
    guardianName: "Wali Siswa",
    guardianPhone: "+6281234567890",
    status,
    currentClassId: options.classId ?? null,
    activatedAt: options.activatedAt === undefined ? defaultActivatedAt : options.activatedAt,
    ...options.data,
  };
}

/** Akun STUDENT (email NULL) + baris Student dalam satu INSERT bertingkat. */
export async function createStudent(schoolId: string, options: CreateStudentOptions = {}): Promise<TestStudent> {
  const created = await prisma.user.create({
    data: {
      ...(await userData(options, "Siswa")),
      role: "STUDENT",
      email: null,
      schoolId,
      student: { create: studentData(schoolId, options) },
    },
    include: { student: true },
  });
  const { student, ...user } = created;
  if (!student) throw new Error("Factory createStudent: baris Student tidak terbentuk");
  return { user, student };
}

// ----------------------------------------------------------------------------- sponsor

export interface CreateSponsorOptions extends CreateUserOptions {
  /** Default APPROVED (siap submit iklan & top-up). */
  readonly status?: SponsorStatus;
  readonly data?: Partial<Omit<Prisma.SponsorCreateInput, "members" | "status">>;
}

export interface TestSponsor {
  readonly sponsor: Sponsor;
  readonly user: TestUser;
}

/** Sponsor (saldo 0) + satu akun SPONSOR anggotanya. */
export async function createSponsor(options: CreateSponsorOptions = {}): Promise<TestSponsor> {
  const email = options.email ?? uniqEmail("sp");
  const created = await prisma.sponsor.create({
    data: {
      companyName: `PT ${uniq("sponsor")}`,
      contactName: "Kontak Sponsor",
      contactEmail: email,
      contactPhone: "+6281298765432",
      status: options.status ?? "APPROVED",
      ...options.data,
      members: { create: { ...(await userData(options, "Sponsor")), role: "SPONSOR", email } },
    },
    include: { members: true },
  });
  const { members, ...sponsor } = created;
  const user = members[0];
  if (!user) throw new Error("Factory createSponsor: akun sponsor tidak terbentuk");
  return { sponsor, user };
}

// ----------------------------------------------------------------------------- berkas

export interface CreateStoredFileOptions {
  readonly schoolId?: string | null;
  readonly sponsorId?: string | null;
  readonly attachedAt?: Date | null;
  readonly mimeType?: string;
}

/**
 * Baris metadata StoredFile saja (TANPA berkas di disk, kunci "private/test/...") untuk kebutuhan FK.
 * Test unduhan/retensi harus membuat berkas lewat layanan storage yang sebenarnya.
 */
export async function createStoredFile(
  uploadedById: string,
  kind: FileKind,
  options: CreateStoredFileOptions = {},
): Promise<StoredFile> {
  return prisma.storedFile.create({
    data: {
      kind,
      storageKey: `private/test/${uniq("f")}.webp`,
      mimeType: options.mimeType ?? "image/webp",
      sizeBytes: 1024,
      sha256: randomBytes(32).toString("hex"),
      uploadedById,
      schoolId: options.schoolId ?? null,
      sponsorId: options.sponsorId ?? null,
      attachedAt: options.attachedAt ?? null,
    },
  });
}
