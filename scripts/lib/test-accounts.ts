/**
 * Akun uji `pnpm db:akun-uji` — berlaku di database mana pun, TERMASUK produksi (bedanya dengan seed demo):
 * super admin uji, sekolah uji (tahun ajaran, kelas, mapel, admin, siswa aktif, absensi 10 hari sekolah
 * terakhir sumber ADMIN bercatatan "data demo"), dan sponsor uji APPROVED (saldo 0, tanpa iklan).
 * Idempoten (kunci alami: email, NPSN, NISN): dijalankan ulang = kata sandi di-reset ke TEST_ACCOUNT_PASSWORD,
 * akun diaktifkan lagi, dan 3 siswa uji dikembalikan ke data awal. Data lain yang dibuat lewat aplikasi (siswa,
 * tagihan, pengumuman baru, dst.) tidak disentuh. Rencana data: ./test-accounts-plan.ts.
 */
import { withTx } from "../../src/lib/tx";
import { ensureSuperAdmin, seedDemoSchool, type DemoSchoolBaseSummary } from "./demo-seed";
import { upsertSponsorLogin } from "./demo-sponsor";
import { TEST_SCHOOL, TEST_SPONSOR, TEST_SUPER_ADMIN } from "./test-accounts-plan";

export interface TestAccountsOptions {
  /** Hash bcrypt TEST_ACCOUNT_PASSWORD (CLI: cost 10). Dipakai semua akun uji. */
  readonly passwordHash: string;
  readonly now?: Date;
}

export interface TestAccountsSummary {
  readonly superAdminId: string;
  readonly school: DemoSchoolBaseSummary;
  readonly sponsorId: string;
}

export async function runTestAccountsSeed(options: TestAccountsOptions): Promise<TestAccountsSummary> {
  const superAdminId = await withTx((tx) => ensureSuperAdmin(tx, options, TEST_SUPER_ADMIN));
  const school = await seedDemoSchool(TEST_SCHOOL, options, options.now ?? new Date());
  const { sponsorId } = await upsertSponsorLogin(TEST_SPONSOR, options.passwordHash);
  return { superAdminId, school, sponsorId };
}
