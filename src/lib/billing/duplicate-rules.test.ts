import { test } from "node:test";
import assert from "node:assert/strict";
import { findNearDuplicates } from "./duplicate-rules";

const candidates = [
  { fileId: "f1", phash: "ffffffffffffffff", submissionId: "s1" },
  { fileId: "f2", phash: "fffffffffffffff0", submissionId: "s2" },
  { fileId: "f3", phash: "0000000000000000", submissionId: "s3" },
  { fileId: "f4", phash: "ffffffffffffff00", submissionId: null },
  { fileId: "f5", phash: null, submissionId: "s5" },
];

test("bukti mirip: jarak Hamming <= batas, tanpa diri sendiri, tanpa berkas tak terikat pengajuan", () => {
  assert.deepEqual(findNearDuplicates({ fileId: "f1", phash: "ffffffffffffffff" }, candidates, 6), ["s2"]);
  assert.deepEqual(findNearDuplicates({ fileId: "fx", phash: "ffffffffffffffff" }, candidates, 6), ["s1", "s2"]);
  assert.deepEqual(findNearDuplicates({ fileId: "fx", phash: "ffffffffffffffff" }, candidates, 3), ["s1"]);
});

test("hash kosong/tidak valid tidak pernah ditandai", () => {
  assert.deepEqual(findNearDuplicates({ fileId: "fx", phash: null }, candidates, 6), []);
  assert.deepEqual(findNearDuplicates({ fileId: "fx", phash: "zz" }, candidates, 6), []);
});
