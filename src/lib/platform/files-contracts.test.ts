import { test } from "node:test";
import assert from "node:assert/strict";
import { fileIdParams, fileResponseHeaders, getFileContract } from "./files-contracts";

const FILE = { kind: "AD_BANNER" as const, size: 4096, mimeType: "image/jpeg", filename: "attendance-selfie-abc123.jpg" };

test("header unduhan: tipe & panjang, nosniff, CSP sandbox, cache privat 5 menit (non-sensitif), inline default", () => {
  assert.deepEqual(fileResponseHeaders(FILE, false), {
    "Content-Type": "image/jpeg",
    "Content-Length": "4096",
    "Content-Disposition": 'inline; filename="attendance-selfie-abc123.jpg"',
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Cache-Control": "private, max-age=300",
    "Referrer-Policy": "no-referrer",
    Vary: "Authorization",
  });
});

test("berkas pribadi anak (selfie, lampiran izin, bukti bayar) tidak boleh disimpan cache: no-store + Pragma", () => {
  for (const kind of ["ATTENDANCE_SELFIE", "LEAVE_ATTACHMENT", "PAYMENT_PROOF"] as const) {
    const headers = fileResponseHeaders({ ...FILE, kind }, false);
    assert.equal(headers["Cache-Control"], "private, no-store", kind);
    assert.equal(headers.Pragma, "no-cache", kind);
    assert.equal(headers["X-Content-Type-Options"], "nosniff", kind);
  }
  assert.equal(fileResponseHeaders(FILE, false).Pragma, undefined);
});

test("download=1 -> attachment; nama berkas disaring ke karakter aman", () => {
  assert.equal(fileResponseHeaders(FILE, true)["Content-Disposition"], 'attachment; filename="attendance-selfie-abc123.jpg"');
  const tricky = fileResponseHeaders({ ...FILE, filename: 'a"b\\c\r\nd;é.jpg' }, true);
  assert.equal(tricky["Content-Disposition"], 'attachment; filename="a_b_c__d__.jpg"');
});

test("kontrak berkas: aksi file.read, biner, 410 FILE_PURGED terdokumentasi; id wajib", () => {
  assert.equal(getFileContract.action, "file.read");
  assert.equal(getFileContract.binary, true);
  assert.deepEqual(getFileContract.errors, ["FILE_PURGED"]);
  assert.equal(fileIdParams.safeParse({ id: "" }).success, false);
  assert.equal(fileIdParams.safeParse({ id: "x".repeat(65) }).success, false);
  assert.equal(getFileContract.query.safeParse({ download: "2" }).success, false);
});
