import assert from "node:assert/strict";
import test from "node:test";
import {
  amountDigits,
  displayNumeric,
  formatAmountInput,
  inputModeFor,
  numericDraft,
  numericSpec,
  parseNumeric,
  rangeProblem,
  sanitizeNumeric,
  type NumericSpec,
} from "./numeric-input-rules";
import type { Schema } from "./types";

const INT_MIN = -9007199254740991;
const INT_MAX = 9007199254740991;
const spec = (name: string, schema: Schema, type = schema.type as string | undefined): NumericSpec => {
  const result = numericSpec(name, schema, type);
  assert.ok(result, `${name} harus dikenali sebagai isian angka`);
  return result;
};

test("jenis isian angka dikenali dari nama & skema OpenAPI", () => {
  assert.equal(spec("sppAmount", { type: "integer", minimum: 0, maximum: 50_000_000 }).kind, "money");
  assert.equal(spec("defaultCpcAmount", { type: "integer", minimum: 100 }).kind, "money");
  assert.equal(spec("guardianPhone", { type: "string" }).kind, "phone");
  assert.equal(spec("contactPhone", { type: "string", pattern: "^\\+?[0-9][0-9 ()-]{5,18}$" }).kind, "phone");
  assert.equal(spec("nisn", { type: "string" }).kind, "digits");
  assert.equal(spec("bankAccountNumber", { type: "string" }).kind, "digits");
  assert.equal(spec("code", { type: "string", pattern: "^\\d{6}$" }).kind, "digits");
  assert.equal(spec("kkm", { type: "integer", minimum: 0, maximum: 100 }).kind, "integer");
  assert.equal(spec("latitude", { type: "number" }).kind, "decimal");
});

test("teks biasa, kode mapel huruf, dan NIS (boleh huruf/garis miring) tetap isian bebas", () => {
  assert.equal(numericSpec("name", { type: "string" }, "string"), null);
  assert.equal(numericSpec("code", { type: "string", pattern: "^[A-Z0-9][A-Z0-9_-]{0,19}$" }, "string"), null);
  assert.equal(numericSpec("nis", { type: "string" }, "string"), null);
  assert.equal(numericSpec("guardianOccupation", { type: "string" }, "string"), null);
});

test("nominal string berpola digit (bukti bayar multipart) tetap dikirim sebagai string", () => {
  const amount = spec("amount", { type: "string", pattern: "^\\d{1,9}$" });
  assert.equal(amount.kind, "money");
  assert.equal(amount.asString, true);
  assert.equal(parseNumeric("150000", amount), "150000");
});

test("tanda minus hanya untuk batas bawah negatif yang nyata (bukan batas bawaan z.int())", () => {
  assert.equal(spec("amount", { type: "integer", minimum: -100_000_000, maximum: 100_000_000 }).signed, true);
  assert.equal(spec("lateToleranceMinutes", { type: "integer", minimum: INT_MIN, maximum: INT_MAX }).signed, false);
  assert.equal(spec("latitude", { type: "number" }).signed, true, "lintang selatan bernilai negatif");
  assert.equal(spec("accuracy", { type: "number", minimum: 0 }).signed, false);
});

test("nomor HP: hanya digit, simbol & spasi hasil tempel dibuang, maks 15 digit", () => {
  const phone = spec("fatherPhone", { type: "string" });
  assert.equal(sanitizeNumeric("+62 812-3456-7890", phone), "6281234567890");
  assert.equal(sanitizeNumeric("08abc12", phone), "0812");
  assert.equal(sanitizeNumeric("1234567890123456789", phone), "123456789012345");
  assert.equal(numericDraft("+6281234567890", phone), "6281234567890", "nilai tersimpan +62… tampil sebagai digit");
});

test("NISN & kode TOTP: digit saja dengan panjang tetap", () => {
  const nisn = spec("nisn", { type: "string" });
  assert.equal(sanitizeNumeric("00a1-2345 67890", nisn), "0012345678");
  assert.equal(rangeProblem("12345", nisn, {}), "Harus 10 digit angka.");
  assert.equal(rangeProblem("0012345678", nisn, {}), "");
  const totp = spec("totpCode", { type: "string", pattern: "^\\d{6}$" });
  assert.equal(sanitizeNumeric("12 34 56 7", totp), "123456");
});

test("nominal rupiah: tampil berpemisah ribuan, dikirim sebagai angka bulat", () => {
  const spp = spec("sppAmount", { type: "integer", minimum: 0, maximum: 50_000_000 });
  assert.equal(sanitizeNumeric("Rp 555.555", spp), "555555");
  assert.equal(displayNumeric("555555", spp), "555.555");
  assert.equal(parseNumeric("555555", spp), 555_555);
  assert.equal(sanitizeNumeric("555.5555", spp), "5555555", "mengetik di belakang teks berformat tetap menambah digit");
  assert.equal(numericDraft(250_000, spp), "250000");
  assert.equal(parseNumeric("", spp), undefined);
  assert.equal(sanitizeNumeric("0", spp), "0", "0 = bebas SPP harus bisa diketik");
  assert.equal(parseNumeric("0", spp), 0);
});

test("nominal bertanda (penyesuaian saldo) mempertahankan minus", () => {
  const amount = spec("amount", { type: "integer", minimum: -100_000_000, maximum: 100_000_000 });
  assert.equal(sanitizeNumeric("-Rp 50.000", amount), "-50000");
  assert.equal(displayNumeric("-50000", amount), "-50.000");
  assert.equal(parseNumeric("-50000", amount), -50_000);
  assert.equal(parseNumeric("-", amount), undefined, "minus saja = belum lengkap");
});

test("bilangan bulat: huruf, titik, dan e ditolak; nol di depan dibuang", () => {
  const kkm = spec("kkm", { type: "integer", minimum: 0, maximum: 100 });
  assert.equal(sanitizeNumeric("7e5", kkm), "75");
  assert.equal(sanitizeNumeric("07", kkm), "7");
  assert.equal(sanitizeNumeric("-5", kkm), "5", "minus tidak boleh bila batas bawah >= 0");
  assert.equal(parseNumeric("75", kkm), 75);
});

test("desimal (koordinat): satu titik, koma diubah ke titik, minus di depan", () => {
  const lat = spec("latitude", { type: "number" });
  assert.equal(sanitizeNumeric("-6,2335", lat), "-6.2335");
  assert.equal(sanitizeNumeric("-6.23.35x", lat), "-6.2335");
  assert.equal(sanitizeNumeric("6-2", lat), "62", "minus hanya di depan");
  assert.equal(parseNumeric("-6.", lat), -6, "titik di akhir tetap bernilai saat diketik");
  assert.equal(numericDraft(-6.2335, lat), "-6.2335");
});

test("pesan batas nilai: rupiah untuk nominal, angka polos untuk lainnya", () => {
  const amount = spec("amount", { type: "integer", minimum: 1000, maximum: 50_000_000 });
  assert.equal(rangeProblem(500, amount, { minimum: 1000, maximum: 50_000_000 }), `Minimal ${"Rp 1.000"}.`);
  assert.equal(rangeProblem(60_000_000, amount, { minimum: 1000, maximum: 50_000_000 }), `Maksimal ${"Rp 50.000.000"}.`);
  const year = spec("periodYear", { type: "integer", minimum: 2000, maximum: 2100 });
  assert.equal(rangeProblem(1999, year, { minimum: 2000, maximum: 2100 }), "Minimal 2000.");
  const minutes = spec("lateToleranceMinutes", { type: "integer", minimum: INT_MIN, maximum: INT_MAX });
  assert.equal(rangeProblem(5, minutes, { minimum: INT_MIN, maximum: INT_MAX }), "");
  assert.equal(rangeProblem(undefined, amount, { minimum: 1000 }), "", "kosong ditangani atribut required");
});

test("keyboard HP: angka saja, desimal untuk koordinat, teks bila perlu tanda minus", () => {
  assert.equal(inputModeFor(spec("guardianPhone", { type: "string" })), "numeric");
  assert.equal(inputModeFor(spec("sppAmount", { type: "integer", minimum: 0 })), "numeric");
  assert.equal(inputModeFor(spec("accuracy", { type: "number", minimum: 0 })), "decimal");
  assert.equal(inputModeFor(spec("latitude", { type: "number" })), "text", "papan desimal iOS tidak punya tombol minus");
});

test("amountDigits & formatAmountInput tetap berperilaku seperti sebelumnya (dipakai form top-up)", () => {
  assert.equal(amountDigits("Rp500.000,00"), "500000");
  assert.equal(amountDigits("1234567890"), "123456789");
  assert.equal(formatAmountInput("1500000"), "1.500.000");
  assert.equal(formatAmountInput(""), "");
});
