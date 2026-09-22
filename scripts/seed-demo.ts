/**
 * Seed data demo: `pnpm db:seed:demo` (dijalankan otomatis setiap deploy staging).
 *
 * - MENOLAK (exit 1) kecuali nama database di DATABASE_URL berakhiran _staging, _dev, atau _test.
 * - Kata sandi SEMUA akun demo diambil dari env DEMO_PASSWORD (>= 8 karakter, huruf + angka), tidak
 *   pernah dari kode, dan tidak pernah dicetak.
 * - Idempoten: upsert berdasarkan kunci alami (lihat scripts/lib/demo-seed.ts); data P3 (SPP Juli-September
 *   2026, rapor Ganjil satu kelas, 3 pengumuman) dan P4 (sponsor demo, top-up, 2 iklan, trafik 14 hari) hanya
 *   ditambahkan bila belum ada.
 */
import "dotenv/config";
import { BCRYPT_COST, hashPassword } from "../src/lib/auth/password";
import { checkDemoPassword, checkSeedDatabaseUrl } from "./lib/demo-data";
import type { DemoSeedSummary } from "./lib/demo-seed";

const TAG = "[seed-demo]";

function printSummary(summary: DemoSeedSummary): void {
  console.log(`${TAG} Super admin: ${summary.superAdminEmail}`);
  console.table(
    summary.schools.map((s) => ({
      Sekolah: s.name,
      NPSN: s.npsn,
      Zona: s.timezone,
      "Admin sekolah": s.adminEmail,
      Kelas: s.classes,
      Mapel: s.subjects,
      "Kelas-mapel": s.classSubjects,
      "Siswa aktif": s.activeStudents,
      "NISN demo": s.nisnRange,
    })),
  );
  console.table(
    summary.schools.map((s) => ({
      Sekolah: s.name,
      "Tagihan SPP": s.billing.invoices,
      Lunas: s.billing.paid,
      Sebagian: s.billing.partial,
      "Belum bayar": s.billing.unpaid,
      Kuitansi: s.billing.payments,
      "Menunggu verifikasi": s.billing.pendingSubmissions,
      "Rapor terbit": `${s.reportCards.published} (${s.reportCards.className})`,
      Pengumuman: s.announcements,
    })),
  );
  for (const s of summary.schools) {
    for (const warning of s.warnings) console.warn(`${TAG} PERINGATAN ${s.name}: ${warning}`);
  }
  const sp = summary.sponsor;
  console.log(`${TAG} Sponsor: ${sp.email} (saldo Rp ${sp.balance}, iklan tayang ${sp.liveAds}, klik tercatat ${sp.clicks})`);
  for (const warning of sp.warnings) console.warn(`${TAG} PERINGATAN sponsor: ${warning}`);
  console.log(`${TAG} Semua akun demo memakai kata sandi dari env DEMO_PASSWORD. Siswa login dengan NISN.`);
}

async function main(): Promise<number> {
  const guard = checkSeedDatabaseUrl(process.env.DATABASE_URL);
  if (!guard.ok) {
    console.error(`${TAG} DITOLAK: ${guard.reason}`);
    return 1;
  }
  const password = process.env.DEMO_PASSWORD ?? "";
  const problems = checkDemoPassword(password);
  if (problems.length > 0) {
    console.error(`${TAG} DITOLAK: DEMO_PASSWORD tidak memenuhi syarat: ${problems.join(" ")}`);
    return 1;
  }
  console.log(`${TAG} Database: "${guard.database}" di ${guard.host}.`);
  const passwordHash = await hashPassword(password, BCRYPT_COST);
  // Impor dinamis: klien Prisma baru dibuat setelah penjaga lolos.
  const { runDemoSeed } = await import("./lib/demo-seed");
  const { prisma } = await import("../src/lib/db");
  try {
    printSummary(await runDemoSeed({ passwordHash }));
  } finally {
    await prisma.$disconnect();
  }
  console.log(`${TAG} Selesai.`);
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`${TAG} Gagal: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
