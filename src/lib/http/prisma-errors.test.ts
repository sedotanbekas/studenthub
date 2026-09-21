import { test } from "node:test";
import assert from "node:assert/strict";
import { isCheckViolation, mapPrismaError } from "./prisma-errors";

test("kode Prisma yang dikenal dipetakan ke AppError tanpa pesan asli", () => {
  assert.deepEqual(
    [mapPrismaError({ code: "P2002", meta: { target: ["nisn"] } })?.status, mapPrismaError({ code: "P2002" })?.code],
    [409, "DUPLICATE"],
  );
  assert.equal(mapPrismaError({ code: "P2025" })?.status, 404);
  assert.equal(mapPrismaError({ code: "P2034" })?.code, "CONFLICT_RETRY");
  assert.equal(mapPrismaError({ code: "P2003" })?.code, "STATE_CONFLICT");
  assert.deepEqual(mapPrismaError({ code: "P2002", meta: { target: ["nisn"] } })?.details, { fields: ["nisn"] });
});

test("error tak dikenal -> null", () => {
  assert.equal(mapPrismaError(new Error("x")), null);
  assert.equal(mapPrismaError(null), null);
  assert.equal(mapPrismaError("teks"), null);
});

test("isCheckViolation mengenali errno 4025 / nama chk_", () => {
  assert.equal(isCheckViolation({ meta: { driverAdapterError: { cause: { code: 4025 } } } }), true);
  assert.equal(isCheckViolation({ meta: { message: "CONSTRAINT `chk_invoice_status` failed" } }), true);
  assert.equal(isCheckViolation({ meta: { target: "x" } }), false);
  assert.equal(isCheckViolation(null), false);
});
