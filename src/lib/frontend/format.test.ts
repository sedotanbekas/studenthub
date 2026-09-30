import assert from "node:assert/strict";
import test from "node:test";
import { display, isClockMinuteField, label } from "./format";
test("teks data dan kredensial sementara ditampilkan persis tanpa humanisasi", () => {
  assert.equal(display("TempSiswa123", "temporaryPassword"), "TempSiswa123");
  assert.equal(display("StudentHub.co.id"), "StudentHub.co.id");
  assert.equal(display("0000123456", "nisn"), "0000123456");
  assert.equal(display("ACTIVE", "status"), "Aktif");
});

test("tahun tampil apa adanya (tanpa pemisah ribuan) dan bulan tampil sebagai nama bulan", () => {
  assert.equal(display(2026, "periodYear"), "2026");
  assert.equal(display(2026, "year"), "2026");
  assert.equal(display(9, "periodMonth"), "September");
  assert.equal(display(1, "month"), "Januari");
  assert.equal(display(13, "periodMonth"), "13");
  assert.equal(display(350000, "amount"), "Rp 350.000".replace(" ", "\u00a0"));
  assert.equal(display(1284, "total"), "1.284");
});

test("label kolom rapor & tagihan berbahasa Indonesia", async () => {
  const { label } = await import("./format");
  assert.equal(label("averageScore"), "Rata-rata nilai");
  assert.equal(label("periodYear"), "Tahun tagihan");
});

test("sisa tagihan ditampilkan sebagai rupiah", () => {
  assert.equal(display(0, "remaining"), "Rp\u00a00");
});

test("kolom jadwal sekolah dikenali sebagai jam, berlabel Indonesia, dan tampil HH:MM", () => {
  for (const key of ["checkInOpenMinute", "startMinute", "checkInCloseMinute", "dayEndMinute"]) {
    assert.equal(isClockMinuteField(key), true, key);
  }
  assert.equal(isClockMinuteField("lateToleranceMinutes"), false);
  assert.equal(label("startMinute"), "Jam masuk");
  assert.equal(label("checkInCloseMinute"), "Absen ditutup");
  assert.equal(label("dayEndMinute"), "Akhir hari sekolah");
  assert.equal(display(420, "startMinute"), "07:00");
  assert.equal(display(905, "dayEndMinute"), "15:05");
  assert.equal(display(15, "lateToleranceMinutes"), "15");
});
