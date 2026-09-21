import { test } from "node:test";
import assert from "node:assert/strict";
import { bulkGradesBody, cardGradesBody } from "./schemas";

const ID = "cjld2cjxh0000qzrmn831i7rn";

test("deskripsi: tidak dikirim tetap undefined (pertahankan), null/kosong -> null (hapus), spasi dirapatkan", () => {
  const parse = (grade: Record<string, unknown>) => cardGradesBody.parse({ grades: [{ subjectId: ID, score: 85, ...grade }] }).grades[0]?.description;
  assert.equal(parse({}), undefined);
  assert.equal(parse({ description: null }), null);
  assert.equal(parse({ description: "   " }), null);
  assert.equal(parse({ description: "  Baik   sekali " }), "Baik sekali");
  const bulk = bulkGradesBody.parse({ termId: ID, classId: ID, subjectId: ID, entries: [{ studentId: ID, score: 70 }] });
  assert.equal(bulk.entries[0]?.description, undefined);
});
