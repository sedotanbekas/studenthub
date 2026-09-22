import assert from "node:assert/strict";
import test from "node:test";
import { cleanBody } from "./action-dialog";
import type { Schema } from "@/lib/frontend/types";

test("formulir mempertahankan cabang target yang dipilih dalam payload bertingkat", () => {
  const schema: Schema = { type: "object", properties: { scope: { oneOf: [
    { type: "object", properties: { type: { const: "ALL" } } },
    { type: "object", properties: { type: { const: "CLASSES" }, classIds: { type: "array", items: { type: "string" } } } },
  ] } } };
  assert.deepEqual(cleanBody({ scope: { type: "CLASSES", classIds: ["class1"] } }, schema), { scope: { type: "CLASSES", classIds: ["class1"] } });
});
test("formulir menjaga angka nol dan null untuk penghapusan nilai", () => {
  const schema: Schema = { type: "object", properties: { score: { type: ["integer", "null"] }, amount: { type: "integer" }, extra: { type: "string" } } };
  assert.deepEqual(cleanBody({ score: null, amount: 0, extra: undefined, unknown: "abaikan" }, schema), { score: null, amount: 0 });
});
