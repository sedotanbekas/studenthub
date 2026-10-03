import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_FACTS, identityCard, identityFacts, logoutNotice, maskNisn, nextLoginNotice, NOT_ME_NOTICE, OFFLINE_NOTICE } from "./identity-confirm-rules";

test("maskNisn: hanya 4 digit terakhir NISN 10 digit; selain itu null", () => {
  assert.equal(maskNisn("0098765432"), "••••5432");
  assert.equal(maskNisn(" 0098765432 "), "••••5432");
  for (const bad of ["", "12345", "00987654321", "00987a5432", null, undefined, 98765432]) assert.equal(maskNisn(bad), null, String(bad));
});

test("identityFacts: kelas & NISN tersamar dari profil; NISN utuh tidak pernah ikut", () => {
  const facts = identityFacts({ className: "X IPA 1", nisn: "0098765432", name: "Alya" });
  assert.deepEqual(facts, { className: "X IPA 1", maskedNisn: "••••5432", nisnTail: "5432" });
  assert.equal(JSON.stringify(facts).includes("0098765432"), false);
  assert.equal(identityFacts({ className: null, nisn: "0098765432" }).className, null);
  assert.equal(identityFacts({ className: "  ", nisn: "0098765432" }).className, null);
  assert.equal(identityFacts({ className: 7, nisn: "x" }).className, null);
  for (const bad of [[], null, "x", undefined]) assert.deepEqual(identityFacts(bad), EMPTY_FACTS);
});

test("identityCard: nama dirapikan + baris fakta; bagian kosong dibuang; label lisan tanpa simbol", () => {
  const full = identityFacts({ className: "X IPA 1", nisn: "0098765432" });
  assert.deepEqual(identityCard(" Alya Putri ", full), { name: "Alya Putri", facts: "X IPA 1 · NISN ••••5432", spoken: "X IPA 1, NISN berakhiran 5432" });
  assert.equal(identityCard("Alya", { ...full, className: null }).facts, "NISN ••••5432");
  assert.deepEqual(identityCard("Alya", EMPTY_FACTS), { name: "Alya", facts: "", spoken: "" });
});

test("logoutNotice: Bukan saya -> penjelasan; gagal keluar dari server -> pesan sambungkan internet; tanpa alasan -> null", () => {
  assert.deepEqual(logoutNotice("NOT_ME", true), NOT_ME_NOTICE);
  assert.match(NOT_ME_NOTICE.title, /keluar dari perangkat ini/);
  assert.deepEqual(logoutNotice("NOT_ME", false), OFFLINE_NOTICE);
  assert.equal(logoutNotice(undefined, true), null);
  assert.equal(logoutNotice(undefined, false), null);
});

test("nextLoginNotice: diisi Bukan saya; dihapus oleh masuk, demo, keluar biasa, dan sesi berakhir", () => {
  const set = nextLoginNotice(null, { kind: "LOGOUT", reason: "NOT_ME", ended: true });
  assert.deepEqual(set, NOT_ME_NOTICE);
  assert.equal(nextLoginNotice(set, { kind: "LOGIN" }), null);
  assert.equal(nextLoginNotice(set, { kind: "DEMO" }), null);
  assert.equal(nextLoginNotice(set, { kind: "LOGOUT", ended: true }), null);
  assert.equal(nextLoginNotice(set, { kind: "EXPIRED" }), null);
});
