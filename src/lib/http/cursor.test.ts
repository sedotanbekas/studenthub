import { test } from "node:test";
import assert from "node:assert/strict";
import { isAppError } from "./errors";
import {
  CURSOR_DEFAULT_LIMIT, CURSOR_MAX_LIMIT, cursorQuerySchema, cursorWhere, decodeCursor, decodeOptionalCursor,
  encodeCursor, sliceCursorPage,
} from "./cursor";

const T = new Date("2026-09-21T01:02:03.456Z");

function assertInvalidCursor(fn: () => unknown, label: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(isAppError(error), label);
    assert.equal(error.status, 400, label);
    assert.equal(error.code, "INVALID_CURSOR", label);
    assert.equal(error.message, "Cursor tidak valid.", label);
    return true;
  });
}

test("encode/decode round-trip", () => {
  const encoded = encodeCursor({ createdAt: T, id: "cm1abcxyz000001" });
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeCursor(encoded), { createdAt: T, id: "cm1abcxyz000001" });
  const json = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  assert.deepEqual(json, { t: T.toISOString(), id: "cm1abcxyz000001" });
});

test("cursor rusak atau dimanipulasi ditolak 400 INVALID_CURSOR", () => {
  const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const valid = encodeCursor({ createdAt: T, id: "abc" });
  const cases: Record<string, string> = {
    kosong: "",
    bukanBase64: "!!!***",
    bukanJson: Buffer.from("halo", "utf8").toString("base64url"),
    array: b64([T.toISOString(), "abc"]),
    nullJson: b64(null),
    tanpaId: b64({ t: T.toISOString() }),
    tanpaT: b64({ id: "abc" }),
    tanggalRusak: b64({ t: "2026-13-45T00:00:00Z", id: "abc" }),
    tanggalBukanIso: b64({ t: "21 Sep 2026", id: "abc" }),
    tNumber: b64({ t: 1_700_000_000_000, id: "abc" }),
    idKosong: b64({ t: T.toISOString(), id: "" }),
    idBerbahaya: b64({ t: T.toISOString(), id: "abc' OR 1=1 --" }),
    idPanjang: b64({ t: T.toISOString(), id: "a".repeat(65) }),
    idBukanString: b64({ t: T.toISOString(), id: 42 }),
    kunciTambahan: b64({ t: T.toISOString(), id: "abc", x: 1 }),
    terpotong: valid.slice(0, -3),
    padding: `${valid}=`,
    terlaluPanjang: "A".repeat(201),
  };
  for (const [label, value] of Object.entries(cases)) assertInvalidCursor(() => decodeCursor(value), label);
});

test("decodeOptionalCursor: undefined → null, string → didekode", () => {
  assert.equal(decodeOptionalCursor(undefined), null);
  assert.equal(decodeOptionalCursor(""), null);
  assert.deepEqual(decodeOptionalCursor(encodeCursor({ createdAt: T, id: "x1" })), { createdAt: T, id: "x1" });
  assertInvalidCursor(() => decodeOptionalCursor("rusak!"), "rusak");
});

test("cursorQuerySchema: default dan batas", () => {
  assert.deepEqual(cursorQuerySchema.parse({}), { limit: 20 });
  assert.equal(CURSOR_DEFAULT_LIMIT, 20);
  assert.equal(CURSOR_MAX_LIMIT, 50);
  assert.deepEqual(cursorQuerySchema.parse({ cursor: "abc", limit: "50" }), { cursor: "abc", limit: 50 });
  assert.equal(cursorQuerySchema.safeParse({ limit: "51" }).success, false);
  assert.equal(cursorQuerySchema.safeParse({ limit: "0" }).success, false);
  assert.equal(cursorQuerySchema.safeParse({ cursor: "a".repeat(201) }).success, false);
});

test("cursorWhere: tanpa cursor → {}; dengan cursor → kondisi (createdAt, id) menurun", () => {
  assert.deepEqual(cursorWhere(null), {});
  assert.deepEqual(cursorWhere({ createdAt: T, id: "m" }), {
    OR: [{ createdAt: { lt: T } }, { createdAt: T, id: { lt: "m" } }],
  });
});

type Row = { id: string; createdAt: Date; title: string };

function rows(count: number): Row[] {
  // Terurut createdAt desc, id desc; dua baris berbagi createdAt yang sama (tie dipecah id).
  return Array.from({ length: count }, (_, i) => ({
    id: `id${String(100 - i).padStart(3, "0")}`,
    createdAt: new Date(T.getTime() - Math.floor(i / 2) * 1000),
    title: `r${i}`,
  }));
}

test("sliceCursorPage: ada halaman berikutnya bila baris > limit", () => {
  const page = sliceCursorPage(rows(4), 3);
  assert.equal(page.items.length, 3);
  assert.equal(page.hasMore, true);
  const last = page.items[2];
  assert.ok(last);
  assert.deepEqual(decodeCursor(page.nextCursor ?? ""), { createdAt: last.createdAt, id: last.id });
});

test("sliceCursorPage: halaman terakhir tanpa nextCursor", () => {
  assert.deepEqual(sliceCursorPage(rows(3), 3), { items: rows(3), nextCursor: null, hasMore: false });
  assert.deepEqual(sliceCursorPage([], 20), { items: [], nextCursor: null, hasMore: false });
});

test("simulasi feed: tie createdAt dipecah id, tanpa duplikat/celah", () => {
  const all = rows(7);
  const matches = (row: Row, where: ReturnType<typeof cursorWhere>): boolean => {
    if (where.OR === undefined) return true;
    const [lt, tie] = where.OR;
    return row.createdAt < lt.createdAt.lt || (row.createdAt.getTime() === tie.createdAt.getTime() && row.id < tie.id.lt);
  };
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const where = cursorWhere(decodeOptionalCursor(cursor ?? undefined));
    const page = sliceCursorPage(all.filter((r) => matches(r, where)).slice(0, 3), 2);
    seen.push(...page.items.map((r) => r.id));
    cursor = page.nextCursor;
  } while (cursor !== null);
  assert.deepEqual(seen, all.map((r) => r.id));
});
