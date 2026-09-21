import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInboxWhere, buildReadAllWhere, kindWhere, readAllBound, summarizeUnread } from "./inbox-filters";

const NOW = new Date("2026-09-21T03:00:00.000Z");

test("kindWhere: announcement = tipe ANNOUNCEMENT, personal = selain ANNOUNCEMENT, all = tanpa filter", () => {
  assert.deepEqual(kindWhere("announcement"), { type: "ANNOUNCEMENT" });
  assert.deepEqual(kindWhere("personal"), { type: { not: "ANNOUNCEMENT" } });
  assert.deepEqual(kindWhere("all"), {});
});

test("buildInboxWhere: hanya userId untuk kind=all tanpa filter lain", () => {
  const where = buildInboxWhere({ userId: "u1", kind: "all", unreadOnly: false, cursor: null });
  assert.deepEqual(where, { AND: [{ userId: "u1" }] });
});

test("buildInboxWhere: menggabungkan kind, kategori, unreadOnly, dan cursor lewat AND", () => {
  const cursor = { createdAt: new Date("2026-09-20T00:00:00.000Z"), id: "c1" };
  const where = buildInboxWhere({ userId: "u1", kind: "personal", category: "FINANCE", unreadOnly: true, cursor });
  assert.deepEqual(where, {
    AND: [
      { userId: "u1" },
      { type: { not: "ANNOUNCEMENT" } },
      { category: "FINANCE" },
      { readAt: null },
      { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: "c1" } }] },
    ],
  });
});

test("readAllBound: memakai before bila lebih awal dari now, selain itu now (tidak pernah di masa depan)", () => {
  const earlier = new Date("2026-09-21T02:00:00.000Z");
  const later = new Date("2026-09-22T00:00:00.000Z");
  assert.equal(readAllBound(undefined, NOW), NOW);
  assert.equal(readAllBound(earlier, NOW), earlier);
  assert.equal(readAllBound(later, NOW), NOW);
  assert.equal(readAllBound(new Date(NOW.getTime()), NOW).getTime(), NOW.getTime());
});

test("buildReadAllWhere: belum dibaca milik pengguna, createdAt <= batas, plus filter kind", () => {
  assert.deepEqual(buildReadAllWhere({ userId: "u1", kind: "all", bound: NOW }), {
    AND: [{ userId: "u1", readAt: null, createdAt: { lte: NOW } }],
  });
  assert.deepEqual(buildReadAllWhere({ userId: "u1", kind: "announcement", bound: NOW }), {
    AND: [{ userId: "u1", readAt: null, createdAt: { lte: NOW } }, { type: "ANNOUNCEMENT" }],
  });
});

test("summarizeUnread: memisahkan pengumuman vs personal dan mengambil createdAt terbaru", () => {
  const a = new Date("2026-09-20T01:00:00.000Z");
  const b = new Date("2026-09-21T01:00:00.000Z");
  const summary = summarizeUnread([
    { type: "ANNOUNCEMENT", count: 3, latest: a },
    { type: "INVOICE_ISSUED", count: 2, latest: b },
    { type: "LEAVE_APPROVED", count: 1, latest: null },
  ]);
  assert.deepEqual(summary, { total: 6, announcements: 3, personal: 3, latestCreatedAt: b });
});

test("summarizeUnread: kosong -> semua nol dan latestCreatedAt null", () => {
  assert.deepEqual(summarizeUnread([]), { total: 0, announcements: 0, personal: 0, latestCreatedAt: null });
});
