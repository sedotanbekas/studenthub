import { test } from "node:test";
import assert from "node:assert/strict";
import { lateReasonBody } from "./late-reason-schemas";

test("body valid: keterangan dinormalkan, kosong -> null, tidak dikirim -> null", () => {
  assert.deepEqual(lateReasonBody.parse({ category: "WEATHER", note: "  Hujan\n deras " }), { category: "WEATHER", note: "Hujan deras" });
  assert.deepEqual(lateReasonBody.parse({ category: "TRANSPORT", note: "   " }), { category: "TRANSPORT", note: null });
  assert.deepEqual(lateReasonBody.parse({ category: "TRANSPORT" }), { category: "TRANSPORT", note: null });
  assert.deepEqual(lateReasonBody.parse({ category: "OTHER", note: "Ban sepeda bocor" }), { category: "OTHER", note: "Ban sepeda bocor" });
});

test("Lainnya tanpa keterangan / terlalu pendek -> galat di path note", () => {
  for (const note of [undefined, null, "", "abcd"]) {
    const result = lateReasonBody.safeParse({ category: "OTHER", note });
    assert.equal(result.success, false);
    assert.deepEqual(result.error?.issues.map((i) => i.path.join(".")), ["note"]);
    assert.match(result.error?.issues[0]?.message ?? "", /minimal 5 karakter/);
  }
});

test("kategori tak dikenal, kunci tambahan, keterangan terlalu panjang -> ditolak", () => {
  assert.equal(lateReasonBody.safeParse({ category: "LAZY" }).success, false);
  assert.equal(lateReasonBody.safeParse({ category: "TRANSPORT", extra: 1 }).success, false);
  assert.equal(lateReasonBody.safeParse({ category: "TRANSPORT", note: "x".repeat(201) }).success, false);
  assert.equal(lateReasonBody.safeParse({ category: "TRANSPORT", note: "x".repeat(401) }).success, false);
  assert.equal(lateReasonBody.safeParse({}).success, false);
});
