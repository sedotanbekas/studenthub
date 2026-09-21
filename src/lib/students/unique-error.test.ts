import { test } from "node:test";
import assert from "node:assert/strict";
import { uniqueIndexOf } from "./unique-error";

const adapterError = (index: string) => ({
  code: "P2002",
  meta: { modelName: "User", driverAdapterError: { name: "DriverAdapterError", cause: { kind: "UniqueConstraintViolation", constraint: { index } } } },
});

test("indeks unik dari driverAdapterError (adapter MariaDB)", () => {
  assert.equal(uniqueIndexOf(adapterError("Student_activeNisn_key")), "Student_activeNisn_key");
});

test("indeks unik dari meta.target (string atau array)", () => {
  assert.equal(uniqueIndexOf({ code: "P2002", meta: { target: "Student_schoolId_nis_key" } }), "Student_schoolId_nis_key");
  assert.equal(uniqueIndexOf({ code: "P2002", meta: { target: ["schoolId", "nisn"] } }), "schoolId,nisn");
});

test("bukan P2002 -> null", () => {
  assert.equal(uniqueIndexOf({ code: "P2025" }), null);
  assert.equal(uniqueIndexOf(new Error("x")), null);
  assert.equal(uniqueIndexOf(null), null);
});

test("P2002 tanpa meta dikenali dengan indeks kosong", () => {
  assert.equal(uniqueIndexOf({ code: "P2002" }), "");
});
