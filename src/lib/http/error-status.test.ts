import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ALL_CONTRACTS } from "@/lib/openapi/registry";
import { DEFAULT_ERROR_STATUS, ERROR_STATUS, MIXED_STATUS_CODES, statusForCode } from "./error-status";

const LIB_DIR = join(process.cwd(), "src", "lib");
const HELPER_STATUS: Readonly<Record<string, number>> = {
  badRequest: 400, unauthorized: 401, forbidden: 403, conflict: 409, gone: 410, unprocessable: 422,
};
const HELPER_CALL = /\b(badRequest|unauthorized|forbidden|conflict|gone|unprocessable)\(\s*"([A-Z][A-Z0-9_]+)"/g;
const NOT_FOUND_CALL = /\bnotFound\(\s*(?:"[^"]*"|`[^`]*`)\s*,\s*"([A-Z][A-Z0-9_]+)"/g;
const APP_ERROR_CALL = /new AppError\(\s*(\d{3})\s*,\s*"([A-Z][A-Z0-9_]+)"/g;

type Thrown = { readonly code: string; readonly status: number; readonly file: string };

function sourceFiles(): string[] {
  return readdirSync(LIB_DIR, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file) => join(LIB_DIR, file));
}

/** Semua kode AppError berliteral yang dilempar di src/lib beserta status aktualnya. */
function thrownCodes(): Thrown[] {
  return sourceFiles().flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return [
      ...[...text.matchAll(HELPER_CALL)].map((m) => ({ code: m[2] ?? "", status: HELPER_STATUS[m[1] ?? ""] ?? 0, file })),
      ...[...text.matchAll(NOT_FOUND_CALL)].map((m) => ({ code: m[1] ?? "", status: 404, file })),
      ...[...text.matchAll(APP_ERROR_CALL)].map((m) => ({ code: m[2] ?? "", status: Number(m[1]), file })),
    ];
  });
}

test("statusForCode: kode dikenal sesuai status aktual, tak dikenal -> 422", () => {
  assert.equal(statusForCode("INVALID_CREDENTIALS"), 401);
  assert.equal(statusForCode("TEMP_PASSWORD_EXPIRED"), 403);
  assert.equal(statusForCode("ACCOUNT_INACTIVE"), 401);
  assert.equal(statusForCode("NISN_LOCKED"), 409);
  assert.equal(statusForCode("FILE_PURGED"), 410);
  assert.equal(statusForCode("LENGTH_REQUIRED"), 411);
  assert.equal(statusForCode("PAYLOAD_TOO_LARGE"), 413);
  assert.equal(statusForCode("HEIC_NOT_SUPPORTED"), 415);
  assert.equal(statusForCode("RATE_LIMITED"), 429);
  assert.equal(statusForCode("KODE_TIDAK_DIKENAL"), DEFAULT_ERROR_STATUS);
  assert.equal(DEFAULT_ERROR_STATUS, 422);
});

test("statusForCode tidak tertipu properti prototype", () => {
  for (const code of ["constructor", "toString", "__proto__", "hasOwnProperty"]) assert.equal(statusForCode(code), 422);
});

test("semua status di peta adalah status error HTTP yang valid", () => {
  for (const [code, status] of Object.entries(ERROR_STATUS)) assert.ok(status >= 400 && status <= 599, `${code} -> ${status}`);
});

test("setiap kode AppError yang dilempar di src/lib terpetakan ke status aktualnya", () => {
  const thrown = thrownCodes();
  assert.ok(thrown.length > 50, "pemindaian sumber harus menemukan kode error");
  const problems = thrown.filter(({ code, status }) => {
    if (!Object.hasOwn(ERROR_STATUS, code)) return true;
    return ERROR_STATUS[code] !== status && !(MIXED_STATUS_CODES[code] ?? []).includes(status);
  });
  assert.deepEqual(problems.map((p) => `${p.code}:${p.status} (${relative(process.cwd(), p.file)})`), []);
});

test("setiap kode di contract.errors terdaftar di ERROR_STATUS", () => {
  const missing = new Set(ALL_CONTRACTS.flatMap((c) => c.errors ?? []).filter((code) => !Object.hasOwn(ERROR_STATUS, code)));
  assert.deepEqual([...missing], []);
});

test("kode bercampur: status utama ada di daftar varian", () => {
  for (const [code, statuses] of Object.entries(MIXED_STATUS_CODES)) {
    assert.ok(statuses.includes(statusForCode(code)), code);
    assert.ok(statuses.length > 1, code);
  }
});
