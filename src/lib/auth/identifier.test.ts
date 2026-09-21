import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIdentifier, limiterIdentifier } from "./identifier";

test("10 digit = NISN (spasi di tepi dipangkas)", () => {
  assert.deepEqual(classifyIdentifier("0012345678"), { kind: "NISN", nisn: "0012345678" });
  assert.deepEqual(classifyIdentifier("  1234567890 "), { kind: "NISN", nisn: "1234567890" });
});

test("9 atau 11 digit dan 0000000000 tidak valid", () => {
  assert.equal(classifyIdentifier("123456789").kind, "INVALID");
  assert.equal(classifyIdentifier("12345678901").kind, "INVALID");
  assert.equal(classifyIdentifier("0000000000").kind, "INVALID");
});

test("email di-lowercase; +tag diterima", () => {
  assert.deepEqual(classifyIdentifier(" Admin.Sekolah@Contoh.SCH.ID "), { kind: "EMAIL", email: "admin.sekolah@contoh.sch.id" });
  assert.deepEqual(classifyIdentifier("guru+tag@contoh.id"), { kind: "EMAIL", email: "guru+tag@contoh.id" });
});

test("sampah ditolak", () => {
  for (const raw of ["", "   ", "admin", "admin@", "@contoh.id", "12345abcde", "a b@c.id", "1234567890@"]) {
    assert.equal(classifyIdentifier(raw).kind, "INVALID", raw);
  }
});

test("email melebihi 191 karakter ditolak", () => {
  const local = "a".repeat(64);
  const domain = `${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(10)}.id`;
  assert.equal(classifyIdentifier(`${local}@${domain}`).kind, "INVALID");
});

test("limiterIdentifier menormalkan NISN/email; INVALID -> null", () => {
  assert.equal(limiterIdentifier(classifyIdentifier("A@B.ID")), "a@b.id");
  assert.equal(limiterIdentifier(classifyIdentifier(" 1234567890")), "1234567890");
  assert.equal(limiterIdentifier(classifyIdentifier("x")), null);
});
