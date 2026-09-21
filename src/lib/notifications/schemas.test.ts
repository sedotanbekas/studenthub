import { test } from "node:test";
import assert from "node:assert/strict";
import { listInboxQuerySchema, notificationIdParams, readAllBodySchema } from "./schemas";

test("query list: default kind=all, unreadOnly=false, limit=20", () => {
  const parsed = listInboxQuerySchema.parse({});
  assert.equal(parsed.kind, "all");
  assert.equal(parsed.unreadOnly, false);
  assert.equal(parsed.limit, 20);
  assert.equal(parsed.cursor, undefined);
  assert.equal(parsed.category, undefined);
});

test("query list: string query dikonversi (limit angka, unreadOnly boolean)", () => {
  const parsed = listInboxQuerySchema.parse({ kind: "personal", category: "FINANCE", unreadOnly: "true", limit: "5" });
  assert.deepEqual(
    { kind: parsed.kind, category: parsed.category, unreadOnly: parsed.unreadOnly, limit: parsed.limit },
    { kind: "personal", category: "FINANCE", unreadOnly: true, limit: 5 },
  );
  assert.equal(listInboxQuerySchema.parse({ unreadOnly: "false" }).unreadOnly, false);
});

test("query list: nilai tidak sah ditolak", () => {
  for (const bad of [{ kind: "semua" }, { category: "OTHER" }, { unreadOnly: "yes" }, { limit: "0" }, { limit: "51" }, { limit: "abc" }]) {
    assert.equal(listInboxQuerySchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
});

test("params id: format id aman saja", () => {
  assert.equal(notificationIdParams.safeParse({ id: "cmabc123xyz" }).success, true);
  assert.equal(notificationIdParams.safeParse({ id: "../etc" }).success, false);
  assert.equal(notificationIdParams.safeParse({ id: "" }).success, false);
  assert.equal(notificationIdParams.safeParse({ id: "a".repeat(65) }).success, false);
});

test("body read-all: opsional, before ISO -> Date, kunci asing ditolak", () => {
  assert.deepEqual(readAllBodySchema.parse({}), {});
  const parsed = readAllBodySchema.parse({ before: "2026-09-21T10:00:00+07:00", kind: "announcement" });
  assert.equal(parsed.before?.toISOString(), "2026-09-21T03:00:00.000Z");
  assert.equal(parsed.kind, "announcement");
  assert.equal(readAllBodySchema.safeParse({ before: "kemarin" }).success, false);
  assert.equal(readAllBodySchema.safeParse({ before: "2026-09-21" }).success, false);
  assert.equal(readAllBodySchema.safeParse({ kind: "semua" }).success, false);
  assert.equal(readAllBodySchema.safeParse({ all: true }).success, false);
});
