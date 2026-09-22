import assert from "node:assert/strict";
import test from "node:test";
import { display } from "./format";
test("teks data dan kredensial sementara ditampilkan persis tanpa humanisasi", () => {
  assert.equal(display("TempSiswa123", "temporaryPassword"), "TempSiswa123");
  assert.equal(display("StudentHub.co.id"), "StudentHub.co.id");
  assert.equal(display("0000123456", "nisn"), "0000123456");
  assert.equal(display("ACTIVE", "status"), "Aktif");
});
