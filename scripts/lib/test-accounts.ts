/**
 * Akun uji `pnpm db:akun-uji` — berlaku di database mana pun, TERMASUK produksi (bedanya dengan seed demo):
 * super admin uji, sekolah uji (tahun ajaran, kelas, mapel, admin, siswa aktif, absensi 10 hari sekolah
 * terakhir sumber ADMIN bercatatan "data demo"), dan sponsor uji APPROVED (saldo 0, tanpa iklan).
 * Idempoten (kunci alami: email, NPSN, NISN): dijalankan ulang = kata sandi di-reset ke TEST_ACCOUNT_PASSWORD,
 * akun diaktifkan lagi, dan 3 siswa uji dikembalikan ke data awal. Data lain yang dibuat lewat aplikasi (siswa,
 * tagihan, pengumuman baru, dst.) tidak disentuh. Rencana data: ./test-accounts-plan.ts.
 * Sejak 2026-10-07: sekolah uji Kota Depok + akun contoh Admin Kota Depok (REGION_ADMIN).
 */
import type { Tx } from "../../src/lib/db";
import { withTx } from "../../src/lib/tx";
import { ensureSuperAdmin, seedDemoSchool, type DemoSchoolBaseSummary } from "./demo-seed";
import { upsertSponsorLogin } from "./demo-sponsor";
import { TEST_DEPOK_SCHOOL, TEST_REGION_ADMIN, TEST_SCHOOL, TEST_SPONSOR, TEST_SUPER_ADMIN } from "./test-accounts-plan";

export interface TestAccountsOptions {
  /** Hash bcrypt TEST_ACCOUNT_PASSWORD (CLI: cost 10). Dipakai semua akun uji. */
  readonly passwordHash: string;
  readonly now?: Date;
}

export interface TestAccountsSummary {
  readonly superAdminId: string;
  readonly school: DemoSchoolBaseSummary;
  readonly sponsorId: string;
  readonly depokSchool: DemoSchoolBaseSummary;
  readonly regionAdminId: string;
}

/**
 * Akun contoh Admin Kota Depok. Email sudah dipakai akun jenis lain -> DITOLAK (seed tidak pernah mengubah jenis
 * akun orang lain); akun Admin Pemda yang sama -> kata sandi di-reset & diaktifkan lagi.
 */
async function ensureRegionAdmin(tx: Tx, passwordHash: string): Promise<string> {
  const { email, name, provinceCode, cityCode } = TEST_REGION_ADMIN;
  const existing = await tx.user.findUnique({ where: { email }, select: { role: true } });
  if (existing && existing.role !== "REGION_ADMIN") throw new Error(`Email ${email} sudah dipakai akun berjenis ${existing.role}; akun contoh Admin Pemda tidak dibuat.`);
  const fields = { name, passwordHash, isActive: true, mustChangePassword: false, tempPasswordExpiresAt: null, role: "REGION_ADMIN" as const, schoolId: null, sponsorId: null, regionProvinceCode: provinceCode, regionCityCode: cityCode };
  return (await tx.user.upsert({ where: { email }, create: { ...fields, email }, update: fields, select: { id: true } })).id;
}

export async function runTestAccountsSeed(options: TestAccountsOptions): Promise<TestAccountsSummary> {
  const superAdminId = await withTx((tx) => ensureSuperAdmin(tx, options, TEST_SUPER_ADMIN));
  const school = await seedDemoSchool(TEST_SCHOOL, options, options.now ?? new Date());
  const { sponsorId } = await upsertSponsorLogin(TEST_SPONSOR, options.passwordHash);
  const depokSchool = await seedDemoSchool(TEST_DEPOK_SCHOOL, options, options.now ?? new Date());
  const regionAdminId = await withTx((tx) => ensureRegionAdmin(tx, options.passwordHash));
  return { superAdminId, school, sponsorId, depokSchool, regionAdminId };
}
