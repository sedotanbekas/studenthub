import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_STUDENT_PASSWORD } from "@/lib/students/constants";
import { loginIdentifiers, needsDefaultCheck, passwordState } from "./credential-rules";

const NOW = new Date("2026-10-05T03:00:00.000Z");
const LATER = new Date("2026-10-19T03:00:00.000Z");
const EARLIER = new Date("2026-10-01T03:00:00.000Z");

test("loginIdentifiers: siswa masuk dengan NISN aktif; tanpa NISN aktif belum bisa masuk", () => {
  assert.deepEqual(loginIdentifiers({ role: "STUDENT", email: null, primaryNpsn: null, activeNisn: "0000000001" }), [
    { kind: "NISN", value: "0000000001" },
  ]);
  assert.deepEqual(loginIdentifiers({ role: "STUDENT", email: null, primaryNpsn: null, activeNisn: null }), []);
});

test("loginIdentifiers: admin utama = NPSN (+ email bila ada); akun lain = email", () => {
  assert.deepEqual(loginIdentifiers({ role: "SCHOOL_ADMIN", email: "a@x.id", primaryNpsn: "21052003", activeNisn: null }), [
    { kind: "NPSN", value: "21052003" },
    { kind: "EMAIL", value: "a@x.id" },
  ]);
  assert.deepEqual(loginIdentifiers({ role: "SCHOOL_ADMIN", email: null, primaryNpsn: "21052003", activeNisn: null }), [{ kind: "NPSN", value: "21052003" }]);
  assert.deepEqual(loginIdentifiers({ role: "SPONSOR", email: "s@x.id", primaryNpsn: null, activeNisn: null }), [{ kind: "EMAIL", value: "s@x.id" }]);
});

test("passwordState: sudah diganti pemilik -> OWN tanpa teks kata sandi", () => {
  const state = passwordState({ mustChangePassword: false, tempPasswordExpiresAt: null, passwordChangedAt: EARLIER, matchesDefault: false }, NOW);
  assert.deepEqual(state, { kind: "OWN", plain: null, expiresAt: null, expired: false, changedAt: EARLIER.toISOString() });
});

test("passwordState: masih kata sandi bawaan siswa -> DEFAULT + teks apa adanya", () => {
  const state = passwordState({ mustChangePassword: true, tempPasswordExpiresAt: LATER, passwordChangedAt: null, matchesDefault: true }, NOW);
  assert.deepEqual(state, { kind: "DEFAULT", plain: DEFAULT_STUDENT_PASSWORD, expiresAt: LATER.toISOString(), expired: false, changedAt: null });
});

test("passwordState: sementara acak & yang ditentukan admin; kedaluwarsa bila lewat (sama dengan login)", () => {
  const temporary = passwordState({ mustChangePassword: true, tempPasswordExpiresAt: EARLIER, passwordChangedAt: null, matchesDefault: false }, NOW);
  assert.equal(temporary.kind, "TEMPORARY");
  assert.equal(temporary.expired, true);
  assert.equal(temporary.plain, null);
  const exact = passwordState({ mustChangePassword: true, tempPasswordExpiresAt: NOW, passwordChangedAt: null, matchesDefault: false }, NOW);
  assert.equal(exact.expired, false, "login menolak hanya bila expiry < now");
  const adminSet = passwordState({ mustChangePassword: true, tempPasswordExpiresAt: null, passwordChangedAt: null, matchesDefault: false }, NOW);
  assert.deepEqual(adminSet, { kind: "ADMIN_SET", plain: null, expiresAt: null, expired: false, changedAt: null });
});

test("needsDefaultCheck: hanya siswa yang masih wajib ganti kata sandi", () => {
  assert.equal(needsDefaultCheck("STUDENT", true), true);
  assert.equal(needsDefaultCheck("STUDENT", false), false);
  assert.equal(needsDefaultCheck("SCHOOL_ADMIN", true), false);
});
