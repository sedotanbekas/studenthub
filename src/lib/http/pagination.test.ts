import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE, MAX_PAGE_LIMIT, pageQuerySchema, toSkipTake } from "./pagination";

test("default page=1 limit=20", () => {
  assert.deepEqual(pageQuerySchema.parse({}), { page: 1, limit: 20 });
  assert.equal(DEFAULT_PAGE_LIMIT, 20);
});

test("string query di-coerce menjadi angka", () => {
  assert.deepEqual(pageQuerySchema.parse({ page: "3", limit: "50" }), { page: 3, limit: 50 });
  assert.deepEqual(pageQuerySchema.parse({ page: "10000", limit: "100" }), { page: MAX_PAGE, limit: MAX_PAGE_LIMIT });
});

test("limit > 100 ditolak (tidak di-clamp)", () => {
  const result = pageQuerySchema.safeParse({ limit: "101" });
  assert.equal(result.success, false);
  assert.deepEqual(result.error?.issues[0]?.path, ["limit"]);
});

test("nilai di luar rentang atau bukan bilangan bulat ditolak", () => {
  for (const input of [{ page: "0" }, { page: "10001" }, { limit: "0" }, { page: "1.5" }, { limit: "abc" }, { page: "-1" }, { page: "" }]) {
    assert.equal(pageQuerySchema.safeParse(input).success, false, JSON.stringify(input));
  }
});

test("pesan validasi berbahasa Indonesia", () => {
  const result = pageQuerySchema.safeParse({ limit: "500" });
  assert.match(result.error?.issues[0]?.message ?? "", /maksimal 100/);
});

test("toSkipTake menghitung offset", () => {
  assert.deepEqual(toSkipTake({ page: 1, limit: 20 }), { skip: 0, take: 20 });
  assert.deepEqual(toSkipTake({ page: 3, limit: 25 }), { skip: 50, take: 25 });
});
