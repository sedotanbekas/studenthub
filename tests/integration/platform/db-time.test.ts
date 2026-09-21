/**
 * Kontrak waktu basis data (docs/PLAN.md "Waktu"): koneksi time_zone '+00:00' lewat initSql,
 * @db.Date = UTC-midnight dari tanggal lokal, DATETIME = instant UTC, DEFAULT CURRENT_TIMESTAMP
 * konsisten dengan jam proses. Semua asersi harus benar APA PUN TZ proses (lokal Windows bisa WIB).
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { fromDbDate, toDbDate } from "../../../src/lib/time/zone";
import { disconnect, prisma, uniq } from "../helpers/db";

after(disconnect);

const MAX_DEFAULT_SKEW_MS = 5_000;
const PARALLEL_CONNECTIONS = 4;

describe("platform: waktu basis data", () => {
  test("setiap koneksi pool memakai @@session.time_zone '+00:00' (initSql src/lib/db.ts)", async () => {
    const rows = await Promise.all(
      Array.from({ length: PARALLEL_CONNECTIONS }, () =>
        prisma.$transaction(async (tx) => tx.$queryRaw<{ tz: string }[]>`SELECT @@session.time_zone AS tz`),
      ),
    );
    for (const row of rows) assert.equal(row[0]?.tz, "+00:00");
  });

  test("@db.Date 2026-09-21 ditulis via toDbDate dan terbaca kembali utuh via fromDbDate", async () => {
    // Libur nasional (schoolId null) berlaku untuk SEMUA sekolah di DB test: wajib dihapus lagi agar
    // test absensi berjam nyata pada tanggal ini tidak mendapat NOT_SCHOOL_DAY.
    const holiday = await prisma.holiday.create({
      data: { name: `Libur ${uniq("h")}`, startDate: toDbDate("2026-09-21"), endDate: toDbDate("2026-09-21") },
    });
    try {
      const read = await prisma.holiday.findUniqueOrThrow({ where: { id: holiday.id } });
      assert.equal(fromDbDate(read.startDate), "2026-09-21");
      assert.equal(read.startDate.getTime(), Date.UTC(2026, 8, 21), "harus UTC-midnight");

      const raw = await prisma.$queryRaw<{ d: string }[]>`
        SELECT CAST(startDate AS CHAR) AS d FROM Holiday WHERE id = ${holiday.id}`;
      assert.equal(raw[0]?.d, "2026-09-21", "nilai tersimpan di DB = tanggal lokal, tidak bergeser zona");
    } finally {
      await prisma.holiday.deleteMany({ where: { id: holiday.id } });
    }
  });

  test("DATETIME instan UTC roundtrip tanpa pergeseran (termasuk batas 16:59:59Z = 23:59 WIB)", async () => {
    const instant = new Date("2026-09-21T16:59:59.123Z");
    const run = await prisma.jobRun.create({
      data: { job: "test-db-time", scopeKey: uniq("scope"), runKey: "2026-09-21", status: "SUCCEEDED", startedAt: instant },
    });
    const read = await prisma.jobRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(read.startedAt.toISOString(), instant.toISOString());

    const raw = await prisma.$queryRaw<{ s: string }[]>`
      SELECT CAST(startedAt AS CHAR) AS s FROM JobRun WHERE id = ${run.id}`;
    assert.equal(raw[0]?.s, "2026-09-21 16:59:59.123", "DATETIME disimpan sebagai jam dinding UTC");
  });

  test("DEFAULT CURRENT_TIMESTAMP(3) dari DB berada dalam 5 detik dari Date.now()", async () => {
    const key = `test-db-time:${uniq("lock")}`;
    // Sengaja tanpa nilai updatedAt: kolom diisi DEFAULT CURRENT_TIMESTAMP(3) milik MariaDB.
    await prisma.$executeRaw`INSERT INTO AppLock (\`key\`) VALUES (${key})`;
    const row = await prisma.appLock.findUniqueOrThrow({ where: { key } });
    const skew = Math.abs(row.updatedAt.getTime() - Date.now());
    assert.ok(skew < MAX_DEFAULT_SKEW_MS, `selisih default DB ${skew} ms (time_zone sesi salah?)`);
  });

  test("createdAt baris baru (Prisma @default(now())) juga dalam 5 detik dari Date.now()", async () => {
    const run = await prisma.jobRun.create({
      data: { job: "test-db-time", scopeKey: uniq("scope"), runKey: "created-at", status: "RUNNING" },
    });
    const skew = Math.abs(run.startedAt.getTime() - Date.now());
    assert.ok(skew < MAX_DEFAULT_SKEW_MS, `selisih ${skew} ms`);
  });

  test("catatan TZ proses: hasil di atas tidak bergantung pada TZ proses", (t) => {
    // Produksi & CI menjalankan proses dengan TZ=UTC; lokal (Windows) bisa WIB. Test di atas
    // membandingkan instant (getTime/toISOString) dan string DB, sehingga lolos di keduanya.
    const offset = new Date("2026-09-21T00:00:00Z").getTimezoneOffset();
    t.diagnostic(`process TZ=${process.env.TZ ?? "(tidak di-set)"}, offset menit=${offset}`);
    assert.equal(toDbDate("2026-09-21").toISOString(), "2026-09-21T00:00:00.000Z");
  });
});
