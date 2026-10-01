/**
 * Rencana akun uji `pnpm db:akun-uji` (murni, diuji unit): akun "sungguhan" untuk blackbox testing di
 * produksi & staging sebelum peluncuran — satu sekolah uji terpisah dari sekolah asli + akun untuk SEMUA
 * peran. Semua email ber-domain uji.studenthub.id (tanpa kotak surat), NISN 99100000xx, NPSN 99990100,
 * sehingga mudah dikenali lalu dinonaktifkan (super admin: nonaktifkan sekolah & sponsor uji) menjelang rilis.
 * Kata sandi SEMUA akun uji dari env TEST_ACCOUNT_PASSWORD — tidak pernah dari kode dan tidak pernah dicetak.
 */
import type { Gender } from "@prisma/client";
import { checkPasswordPolicy, PASSWORD_VIOLATION_MESSAGES } from "../../src/lib/auth/password";
import type { DemoClassSpec, DemoSchoolSpec, DemoStudentSpec } from "./demo-data";

export const TEST_EMAIL_DOMAIN = "uji.studenthub.id";
export const TEST_SUPER_ADMIN = { email: `superadmin@${TEST_EMAIL_DOMAIN}`, name: "Super Admin Uji" } as const;
export const TEST_SPONSOR = {
  email: `sponsor@${TEST_EMAIL_DOMAIN}`,
  loginName: "Sponsor Uji",
  companyName: "PT Sponsor Uji studenthub.id",
  contactName: "Kontak Sponsor Uji",
  phone: "+6281299990901",
} as const;

const CLASSES: readonly DemoClassSpec[] = [
  { name: "X-1", gradeLevel: 10 },
  { name: "XI-1", gradeLevel: 11 },
];

/** [nama, gender, kelas, nama ayah (= wali), nama ibu, tanggal lahir] */
type TestStudentEntry = readonly [string, Gender, string, string, string, string];
const ROSTER: readonly TestStudentEntry[] = [
  ["Andi Uji Coba", "MALE", "X-1", "Budi Uji Coba", "Sari Uji Coba", "2010-03-14"],
  ["Bunga Uji Coba", "FEMALE", "X-1", "Hendra Uji Coba", "Rina Uji Coba", "2010-08-02"],
  ["Candra Uji Coba", "MALE", "XI-1", "Agus Uji Coba", "Dewi Uji Coba", "2009-11-21"],
];

function testStudent([name, gender, className, fatherName, motherName, birthDate]: TestStudentEntry, i: number): DemoStudentSpec {
  const n = String(i + 1).padStart(2, "0");
  return {
    nisn: `99100000${n}`,
    nis: `UJI0${n}`,
    name,
    gender,
    birthPlace: "Jakarta",
    birthDate,
    address: `Jl. Uji Coba No. ${i + 1}, Jakarta Timur`,
    className,
    phone: `+62857999900${n}`,
    fatherName,
    fatherOccupation: "Wiraswasta",
    fatherPhone: `+62812999900${n}`,
    motherName,
    motherOccupation: "Ibu rumah tangga",
    motherPhone: `+62813999900${n}`,
    guardianName: fatherName,
    guardianOccupation: "Wiraswasta",
    guardianPhone: `+62812999900${n}`,
  };
}

export const TEST_SCHOOL: DemoSchoolSpec = {
  npsn: "99990100",
  name: "SMA Uji studenthub.id",
  educationLevel: "SMA",
  slug: "sma-uji",
  adminEmail: `admin@${TEST_EMAIL_DOMAIN}`,
  address: "Jl. Uji Coba No. 1, Kota Jakarta Timur, DKI Jakarta",
  provinceCode: "31",
  cityCode: "31.75",
  latitude: "-6.2250",
  longitude: "106.9004",
  geofenceRadiusM: 150,
  timezone: "WIB",
  bank: { bankName: "Bank Uji", bankAccountNumber: "0099990100", bankAccountHolder: "SMA Uji studenthub.id" },
  sppAmount: 150_000,
  adminName: "Admin SMA Uji",
  classes: CLASSES,
  subjects: [
    { code: "MTK", name: "Matematika" },
    { code: "BIND", name: "Bahasa Indonesia" },
    { code: "BING", name: "Bahasa Inggris" },
  ],
  students: ROSTER.map(testStudent),
};

export interface TestAccountLogin {
  readonly role: "SUPER_ADMIN" | "SCHOOL_ADMIN" | "SPONSOR" | "STUDENT";
  readonly name: string;
  /** Isian "NISN, NPSN, atau email" di halaman masuk. */
  readonly login: string;
}

export function testAccountLogins(): TestAccountLogin[] {
  return [
    { role: "SUPER_ADMIN", name: TEST_SUPER_ADMIN.name, login: TEST_SUPER_ADMIN.email },
    { role: "SCHOOL_ADMIN", name: TEST_SCHOOL.adminName, login: TEST_SCHOOL.adminEmail ?? "" },
    { role: "SPONSOR", name: TEST_SPONSOR.loginName, login: TEST_SPONSOR.email },
    ...TEST_SCHOOL.students.map((s) => ({ role: "STUDENT" as const, name: `${s.name} (${s.className})`, login: s.nisn })),
  ];
}

/** Kata sandi dari env TEST_ACCOUNT_PASSWORD: kebijakan kata sandi aplikasi (>= 8, huruf + angka, dst.). */
export function checkTestAccountPassword(raw: string | undefined): string[] {
  if (raw === undefined || raw === "") return ["TEST_ACCOUNT_PASSWORD belum diisi."];
  return checkPasswordPolicy(raw).map((violation) => PASSWORD_VIOLATION_MESSAGES[violation]);
}
