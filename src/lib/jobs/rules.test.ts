import { test } from "node:test";
import assert from "node:assert/strict";
import { JOB_ERROR_MAX_CHARS, JOB_MAX_ATTEMPTS, JOB_STALE_MS } from "./constants";
import { decideJobRunTakeover, errorMessageOf, isUniqueViolation, toJsonResult } from "./rules";

const NOW = new Date("2026-09-21T19:30:00Z");
const minutesAgo = (minutes: number): Date => new Date(NOW.getTime() - minutes * 60_000);

test("konstanta job sesuai desain: stale 15 menit, maksimal 5 percobaan, error 2000 karakter", () => {
  assert.equal(JOB_STALE_MS, 15 * 60_000);
  assert.equal(JOB_MAX_ATTEMPTS, 5);
  assert.equal(JOB_ERROR_MAX_CHARS, 2000);
});

test("decideJobRunTakeover: SUCCEEDED → SKIP", () => {
  assert.equal(decideJobRunTakeover({ status: "SUCCEEDED", startedAt: minutesAgo(60), attempts: 1 }, NOW), "SKIP");
});

test("decideJobRunTakeover: FAILED dengan attempts 2 → RETRY", () => {
  assert.equal(decideJobRunTakeover({ status: "FAILED", startedAt: minutesAgo(1), attempts: 2 }, NOW), "RETRY");
});

test("decideJobRunTakeover: FAILED dengan attempts 4 → RETRY, attempts 5 atau lebih → SKIP", () => {
  assert.equal(decideJobRunTakeover({ status: "FAILED", startedAt: minutesAgo(1), attempts: 4 }, NOW), "RETRY");
  assert.equal(decideJobRunTakeover({ status: "FAILED", startedAt: minutesAgo(1), attempts: 5 }, NOW), "SKIP");
  assert.equal(decideJobRunTakeover({ status: "FAILED", startedAt: minutesAgo(1), attempts: 9 }, NOW), "SKIP");
});

test("decideJobRunTakeover: RUNNING segar → SKIP (termasuk tepat 15 menit)", () => {
  assert.equal(decideJobRunTakeover({ status: "RUNNING", startedAt: minutesAgo(1), attempts: 1 }, NOW), "SKIP");
  assert.equal(decideJobRunTakeover({ status: "RUNNING", startedAt: minutesAgo(15), attempts: 1 }, NOW), "SKIP");
});

test("decideJobRunTakeover: RUNNING 16 menit → TAKEOVER", () => {
  assert.equal(decideJobRunTakeover({ status: "RUNNING", startedAt: minutesAgo(16), attempts: 1 }, NOW), "TAKEOVER");
  assert.equal(decideJobRunTakeover({ status: "RUNNING", startedAt: minutesAgo(16), attempts: 4 }, NOW), "TAKEOVER");
});

test("decideJobRunTakeover: RUNNING basi pada percobaan ke-5 → SKIP (batas percobaan tetap berlaku)", () => {
  assert.equal(decideJobRunTakeover({ status: "RUNNING", startedAt: minutesAgo(60), attempts: 5 }, NOW), "SKIP");
});

test("errorMessageOf: pesan Error dipotong maksimal 2000 karakter", () => {
  assert.equal(errorMessageOf(new Error("gagal")), "gagal");
  assert.equal(errorMessageOf(new Error("x".repeat(5000))).length, JOB_ERROR_MAX_CHARS);
});

test("errorMessageOf: nilai bukan Error diubah menjadi teks", () => {
  assert.equal(errorMessageOf("teks"), "teks");
  assert.equal(errorMessageOf(42), "42");
  assert.equal(errorMessageOf(null), "null");
  assert.equal(errorMessageOf(new Error("")), "Error");
});

test("isUniqueViolation: hanya error berkode P2002", () => {
  assert.equal(isUniqueViolation(Object.assign(new Error("dup"), { code: "P2002" })), true);
  assert.equal(isUniqueViolation({ code: "P2002" }), true);
  assert.equal(isUniqueViolation(Object.assign(new Error("x"), { code: "P2025" })), false);
  assert.equal(isUniqueViolation(new Error("P2002")), false);
  assert.equal(isUniqueViolation(null), false);
  assert.equal(isUniqueViolation("P2002"), false);
});

test("toJsonResult: menghasilkan salinan JSON murni (Date → ISO, undefined dibuang, BigInt → string)", () => {
  const input = { count: 3, at: new Date("2026-09-21T00:00:00Z"), skip: undefined, big: BigInt(10), nested: { ok: true } };
  const output = toJsonResult(input);
  assert.deepEqual(output, { count: 3, at: "2026-09-21T00:00:00.000Z", big: "10", nested: { ok: true } });
  assert.notEqual(output, input);
});

test("toJsonResult: nilai yang tidak bisa diserialisasi tidak menggagalkan job", () => {
  const cyclic: Record<string, unknown> = { a: 1 };
  cyclic.self = cyclic;
  assert.deepEqual(toJsonResult(cyclic), { unserializable: true });
});
