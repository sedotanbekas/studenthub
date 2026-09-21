import { test } from "node:test";
import assert from "node:assert/strict";
import { documentNumberRange, formatDocumentNumber, parseDocumentNumber } from "./document-number";

test("formatDocumentNumber: prefiks per jenis, urut 6 digit, melebar setelah 999999", () => {
  assert.equal(formatDocumentNumber("RECEIPT", 2026, 1), "KWT-2026-000001");
  assert.equal(formatDocumentNumber("INVOICE", 2026, 123), "INV-2026-000123");
  assert.equal(formatDocumentNumber("RECEIPT", 2026, 999_999), "KWT-2026-999999");
  assert.equal(formatDocumentNumber("RECEIPT", 2026, 1_000_000), "KWT-2026-1000000");
});

test("formatDocumentNumber menolak urutan/tahun tidak valid", () => {
  assert.throws(() => formatDocumentNumber("INVOICE", 2026, 0), RangeError);
  assert.throws(() => formatDocumentNumber("INVOICE", 2026, 1.5), RangeError);
  assert.throws(() => formatDocumentNumber("INVOICE", 999, 1), RangeError);
});

test("parseDocumentNumber: round-trip; sampah -> null", () => {
  assert.deepEqual(parseDocumentNumber("KWT-2026-000001"), { kind: "RECEIPT", year: 2026, seq: 1 });
  assert.deepEqual(parseDocumentNumber("INV-2027-1000000"), { kind: "INVOICE", year: 2027, seq: 1_000_000 });
  for (const n of [1, 42, 999_999, 1_234_567]) {
    const text = formatDocumentNumber("INVOICE", 2026, n);
    assert.deepEqual(parseDocumentNumber(text), { kind: "INVOICE", year: 2026, seq: n });
  }
  for (const bad of ["", "INV-2026-1", "XXX-2026-000001", "INV-26-000001", "INV-2026-000000", "inv-2026-000001", "INV-2026-00000a"]) {
    assert.equal(parseDocumentNumber(bad), null, bad);
  }
});

test("documentNumberRange: nomor berurutan sebanyak count", () => {
  assert.deepEqual(documentNumberRange("INVOICE", 2026, 9, 3), ["INV-2026-000009", "INV-2026-000010", "INV-2026-000011"]);
  assert.deepEqual(documentNumberRange("INVOICE", 2026, 1, 0), []);
});
