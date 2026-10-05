import type { AccountRow, PasswordView } from "./account-rules";

/**
 * Akun contoh mode demo super admin (halaman Pengguna & detail sekolah). Sekolah sc1/sc2 = sekolah contoh di demo.ts.
 * Tanpa jaringan; tindakan (reset, masuk sebagai) hanya menampilkan pesan demo.
 */
const LATER = "2026-10-19T03:00:00.000Z";
const own = (changedAt: string): PasswordView => ({ kind: "OWN", plain: null, expiresAt: null, expired: false, changedAt });
const bawaan = (expired = false): PasswordView => ({ kind: "DEFAULT", plain: "studenthubid", expiresAt: expired ? "2026-09-20T03:00:00.000Z" : LATER, expired, changedAt: null });
const SC1 = { id: "sc1", name: "SMA Cendekia Nusantara" };
const SC2 = { id: "sc2", name: "SMP Harapan Bangsa" };

type Seed = Pick<AccountRow, "id" | "name" | "role"> & Partial<AccountRow>;
const account = (seed: Seed): AccountRow => ({
  isActive: true, adminKind: null, student: null, sponsor: null, email: null, school: null, lastLoginAt: "2026-10-04T23:40:00.000Z", logins: [], password: own("2026-09-01T03:00:00.000Z"), ...seed,
});
const student = (id: string, name: string, nisn: string, className: string, school: typeof SC1, password: PasswordView, lastLoginAt: string | null): AccountRow =>
  account({ id, name, role: "STUDENT", school, student: { id: `s-${id}`, nisn, nis: nisn.slice(-4), status: "ACTIVE", className }, logins: [{ kind: "NISN", value: nisn }], password, lastLoginAt });

export const DEMO_ACCOUNTS: readonly AccountRow[] = [
  account({ id: "demo-sa", name: "Super Admin Demo", role: "SUPER_ADMIN", email: "superadmin@demo.studenthub.id", logins: [{ kind: "EMAIL", value: "superadmin@demo.studenthub.id" }] }),
  account({ id: "demo-sp", name: "Mitra Belajar", role: "SPONSOR", sponsor: { companyName: "PT Mitra Belajar" }, email: "mitra@demo.studenthub.id", logins: [{ kind: "EMAIL", value: "mitra@demo.studenthub.id" }] }),
  account({ id: "adm1", name: "Admin SMA Cendekia", role: "SCHOOL_ADMIN", adminKind: "PRIMARY", school: SC1, logins: [{ kind: "NPSN", value: "20123456" }] }),
  account({ id: "adm2", name: "Bu Rina (Wali kelas X IPA 1)", role: "SCHOOL_ADMIN", adminKind: "ADDITIONAL", school: SC1, email: "rina@cendekia.sch.id", logins: [{ kind: "EMAIL", value: "rina@cendekia.sch.id" }], password: { kind: "TEMPORARY", plain: null, expiresAt: LATER, expired: false, changedAt: null }, lastLoginAt: null }),
  student("st1", "Alya Putri Ramadhani", "0091234501", "X IPA 1", SC1, bawaan(), null),
  student("st2", "Bima Saputra", "0091234502", "X IPA 1", SC1, own("2026-09-23T01:00:00.000Z"), "2026-10-05T00:05:00.000Z"),
  student("st3", "Citra Lestari", "0091234503", "XI IPS 2", SC1, bawaan(true), null),
  account({ id: "adm3", name: "Admin SMP Harapan", role: "SCHOOL_ADMIN", adminKind: "PRIMARY", school: SC2, logins: [{ kind: "NPSN", value: "20123457" }] }),
  student("st4", "Dimas Pratama", "0091234504", "VIII A", SC2, bawaan(), null),
];

function matches(row: AccountRow, params: URLSearchParams): boolean {
  const q = params.get("q")?.toLowerCase();
  if (params.get("role") && row.role !== params.get("role")) return false;
  if (params.get("schoolId") && row.school?.id !== params.get("schoolId")) return false;
  return !q || row.name.toLowerCase().includes(q) || (row.logins ?? []).some((l) => l.value.toLowerCase().includes(q));
}

export function demoAccounts(params: URLSearchParams): AccountRow[] {
  return DEMO_ACCOUNTS.filter((row) => matches(row, params));
}

export function demoAccountCounts(schoolId: string): { schoolAdmins: number; students: number } {
  const inSchool = DEMO_ACCOUNTS.filter((row) => row.school?.id === schoolId);
  return { schoolAdmins: inSchool.filter((row) => row.role === "SCHOOL_ADMIN").length, students: inSchool.filter((row) => row.role === "STUDENT").length };
}
