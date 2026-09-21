import { test } from "node:test";
import assert from "node:assert/strict";
import { STUDENT_STATUSES, type StudentStatusValue } from "./constants";
import { isLoginStatus, planTransition } from "./status-rules";

const ALLOWED: ReadonlyArray<readonly [StudentStatusValue, StudentStatusValue]> = [
  ["DRAFT", "ACTIVE"],
  ["ACTIVE", "INACTIVE"],
  ["INACTIVE", "ACTIVE"],
  ["ACTIVE", "GRADUATED"],
  ["INACTIVE", "GRADUATED"],
  ["ACTIVE", "MOVED"],
  ["INACTIVE", "MOVED"],
  ["GRADUATED", "MOVED"],
  ["GRADUATED", "ACTIVE"],
  ["MOVED", "ACTIVE"],
];

const key = (from: string, to: string) => `${from}->${to}`;

test("matriks transisi penuh 5x5: hanya pasangan yang diizinkan", () => {
  const allowed = new Set(ALLOWED.map(([from, to]) => key(from, to)));
  for (const from of STUDENT_STATUSES) {
    for (const to of STUDENT_STATUSES) {
      const plan = planTransition(from, to);
      assert.equal(plan !== null, allowed.has(key(from, to)), `${key(from, to)}`);
    }
  }
});

test("transisi ke status yang sama selalu ditolak", () => {
  for (const status of STUDENT_STATUSES) assert.equal(planTransition(status, status), null);
});

test("setiap jalur ke ACTIVE: user aktif, klaim NISN, wajib lengkap, tanpa alasan", () => {
  for (const from of ["DRAFT", "INACTIVE", "GRADUATED", "MOVED"] as const) {
    const plan = planTransition(from, "ACTIVE");
    assert.ok(plan);
    assert.equal(plan.userActive, true);
    assert.equal(plan.nisn, "CLAIM");
    assert.equal(plan.requireComplete, true);
    assert.equal(plan.reasonRequired, false);
    assert.equal(plan.revokeSessions, false);
  }
});

test("ACTIVE -> INACTIVE: user nonaktif, cabut sesi, NISN tetap", () => {
  const plan = planTransition("ACTIVE", "INACTIVE");
  assert.deepEqual(plan, {
    userActive: false,
    nisn: "KEEP",
    revokeSessions: true,
    requireComplete: false,
    reasonRequired: true,
    voidFutureInvoices: false,
  });
});

test("-> GRADUATED: user tetap aktif (login baca-saja), sesi tidak dicabut", () => {
  for (const from of ["ACTIVE", "INACTIVE"] as const) {
    const plan = planTransition(from, "GRADUATED");
    assert.ok(plan);
    assert.equal(plan.userActive, true);
    assert.equal(plan.nisn, "KEEP");
    assert.equal(plan.revokeSessions, false);
    assert.equal(plan.reasonRequired, true);
  }
});

test("-> MOVED: lepas NISN, user nonaktif, cabut sesi, void tagihan masa depan", () => {
  for (const from of ["ACTIVE", "INACTIVE", "GRADUATED"] as const) {
    const plan = planTransition(from, "MOVED");
    assert.ok(plan);
    assert.equal(plan.nisn, "RELEASE");
    assert.equal(plan.userActive, false);
    assert.equal(plan.revokeSessions, true);
    assert.equal(plan.voidFutureInvoices, true);
    assert.equal(plan.reasonRequired, true);
  }
});

test("isLoginStatus hanya ACTIVE & GRADUATED", () => {
  assert.deepEqual(STUDENT_STATUSES.filter(isLoginStatus), ["ACTIVE", "GRADUATED"]);
});
