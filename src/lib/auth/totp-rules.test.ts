import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  hotp,
  isTotpCodeFormat,
  requiresTotpEnrollment,
  TOTP_PERIOD_SECONDS,
  totpCodeAt,
  totpStep,
  verifyTotp,
} from "./totp-rules";

/** Kunci uji RFC 4226/6238 (SHA1): ASCII "12345678901234567890". */
const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");
const at = (seconds: number): Date => new Date(seconds * 1000);

test("hotp: vektor uji RFC 4226 lampiran D (counter 0..9)", () => {
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  expected.forEach((code, counter) => assert.equal(hotp(RFC_SECRET, counter), code, `counter ${counter}`));
});

test("totpCodeAt: vektor uji RFC 6238 lampiran B (SHA1, 8 digit)", () => {
  const vectors: ReadonlyArray<readonly [number, string]> = [
    [59, "94287082"],
    [1_111_111_109, "07081804"],
    [1_111_111_111, "14050471"],
    [1_234_567_890, "89005924"],
    [2_000_000_000, "69279037"],
    [20_000_000_000, "65353130"],
  ];
  for (const [seconds, code] of vectors) {
    assert.equal(totpCodeAt(RFC_SECRET, totpStep(at(seconds)), 8), code, `T=${seconds}`);
  }
});

test("totpCodeAt: 6 digit = 6 digit terakhir vektor RFC 6238", () => {
  assert.equal(totpCodeAt(RFC_SECRET, totpStep(at(59))), "287082");
  assert.equal(totpCodeAt(RFC_SECRET, totpStep(at(1_111_111_109))), "081804");
  assert.equal(totpCodeAt(RFC_SECRET, totpStep(at(2_000_000_000))), "279037");
});

test("totpStep: periode 30 detik, dibulatkan ke bawah", () => {
  assert.equal(TOTP_PERIOD_SECONDS, 30);
  assert.equal(totpStep(at(0)), 0);
  assert.equal(totpStep(at(29)), 0);
  assert.equal(totpStep(at(30)), 1);
  assert.equal(totpStep(new Date(59_999)), 1);
});

test("base32: vektor RFC 4648 dan roundtrip", () => {
  assert.equal(base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
  assert.equal(base32Encode(Buffer.from("f")), "MY");
  assert.equal(base32Encode(RFC_SECRET), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.deepEqual(base32Decode("MZXW6YTBOI"), Buffer.from("foobar"));
  assert.deepEqual(base32Decode("mzxw 6ytb-oi======"), Buffer.from("foobar"));
  const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7]);
  assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
});

test("base32Decode: karakter di luar alfabet ditolak", () => {
  assert.throws(() => base32Decode("MZXW1"), /base32/);
  assert.throws(() => base32Decode("MZ8W"), /base32/);
});

test("isTotpCodeFormat: tepat 6 digit", () => {
  assert.equal(isTotpCodeFormat("012345"), true);
  assert.equal(isTotpCodeFormat("12345"), false);
  assert.equal(isTotpCodeFormat("1234567"), false);
  assert.equal(isTotpCodeFormat("12a456"), false);
  assert.equal(isTotpCodeFormat(" 123456"), false);
});

test("verifyTotp: kode langkah saat ini, sebelumnya, dan sesudahnya (jendela ±1) diterima", () => {
  const now = at(1_111_111_111);
  const step = totpStep(now);
  for (const offset of [-1, 0, 1]) {
    const code = totpCodeAt(RFC_SECRET, step + offset);
    assert.deepEqual(verifyTotp(RFC_SECRET, code, now, null), { ok: true, step: step + offset }, `offset ${offset}`);
  }
});

test("verifyTotp: kode di luar jendela ±1 atau salah format ditolak INVALID", () => {
  const now = at(1_111_111_111);
  const step = totpStep(now);
  assert.deepEqual(verifyTotp(RFC_SECRET, totpCodeAt(RFC_SECRET, step - 2), now, null), { ok: false, reason: "INVALID" });
  assert.deepEqual(verifyTotp(RFC_SECRET, totpCodeAt(RFC_SECRET, step + 2), now, null), { ok: false, reason: "INVALID" });
  assert.deepEqual(verifyTotp(RFC_SECRET, "abcdef", now, null), { ok: false, reason: "INVALID" });
  assert.deepEqual(verifyTotp(RFC_SECRET, "", now, null), { ok: false, reason: "INVALID" });
});

test("verifyTotp: langkah yang sudah dipakai (atau lebih lama) ditolak REPLAY", () => {
  const now = at(1_111_111_111);
  const step = totpStep(now);
  const code = totpCodeAt(RFC_SECRET, step);
  assert.deepEqual(verifyTotp(RFC_SECRET, code, now, step), { ok: false, reason: "REPLAY" });
  assert.deepEqual(verifyTotp(RFC_SECRET, code, now, step + 1), { ok: false, reason: "REPLAY" });
  assert.deepEqual(verifyTotp(RFC_SECRET, code, now, step - 1), { ok: true, step });
});

test("verifyTotp: langkah berikutnya tetap diterima setelah langkah sekarang dipakai", () => {
  const now = at(1_111_111_111);
  const step = totpStep(now);
  assert.deepEqual(verifyTotp(RFC_SECRET, totpCodeAt(RFC_SECRET, step + 1), now, step), { ok: true, step: step + 1 });
});

test("buildOtpauthUri: format Key URI (issuer, label ter-encode, SHA1/6/30)", () => {
  const uri = buildOtpauthUri({ secretBase32: "MZXW6YTBOI", accountName: "admin+1@medialab.co.id", issuer: "Student Hub" });
  assert.equal(
    uri,
    "otpauth://totp/Student%20Hub:admin%2B1%40medialab.co.id?secret=MZXW6YTBOI&issuer=Student%20Hub&algorithm=SHA1&digits=6&period=30",
  );
});

test("requiresTotpEnrollment: hanya SUPER_ADMIN tanpa totpEnabledAt", () => {
  assert.equal(requiresTotpEnrollment("SUPER_ADMIN", null), true);
  assert.equal(requiresTotpEnrollment("SUPER_ADMIN", new Date()), false);
  assert.equal(requiresTotpEnrollment("SCHOOL_ADMIN", null), false);
  assert.equal(requiresTotpEnrollment("STUDENT", null), false);
  assert.equal(requiresTotpEnrollment("SPONSOR", null), false);
});
