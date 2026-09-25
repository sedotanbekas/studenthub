import assert from "node:assert/strict";
import test from "node:test";
import { display } from "./format";
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
