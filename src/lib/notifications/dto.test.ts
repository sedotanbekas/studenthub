import { test } from "node:test";
import assert from "node:assert/strict";
import { toInboxDetailDto, toInboxItemDto, toLinkData, toUnreadCountDto } from "./dto";
import { inboxDetailSchema, inboxItemSchema, unreadCountSchema } from "./schemas";

const CREATED = new Date("2026-09-21T01:02:03.004Z");
const READ = new Date("2026-09-21T05:00:00.000Z");

const baseRow = {
  id: "n1",
  type: "INVOICE_ISSUED" as const,
  category: "FINANCE" as const,
  title: "Tagihan baru",
  body: "Tagihan SPP September telah terbit.",
  data: { screen: "invoice", id: "inv1" },
  announcementId: null,
  readAt: null,
  createdAt: CREATED,
};

test("toLinkData: hanya objek {screen,id} (+count bulat) yang diteruskan; bentuk lain -> null", () => {
  assert.deepEqual(toLinkData({ screen: "invoice", id: "x" }), { screen: "invoice", id: "x" });
  assert.deepEqual(toLinkData({ screen: "leave-review", id: "x", count: 3 }), { screen: "leave-review", id: "x", count: 3 });
  assert.deepEqual(toLinkData({ screen: "invoice", id: "x", count: 1.5, extra: true }), { screen: "invoice", id: "x" });
  assert.equal(toLinkData(null), null);
  assert.equal(toLinkData("teks"), null);
  assert.equal(toLinkData([1, 2]), null);
  assert.equal(toLinkData({ screen: 1, id: "x" }), null);
  assert.equal(toLinkData({ screen: "invoice" }), null);
});

test("toInboxItemDto: instant ISO, readAt null, data tertipe; lolos skema respons", () => {
  const dto = toInboxItemDto(baseRow);
  assert.deepEqual(dto, {
    id: "n1",
    type: "INVOICE_ISSUED",
    category: "FINANCE",
    title: "Tagihan baru",
    body: "Tagihan SPP September telah terbit.",
    data: { screen: "invoice", id: "inv1" },
    announcementId: null,
    readAt: null,
    createdAt: "2026-09-21T01:02:03.004Z",
  });
  assert.equal(inboxItemSchema.safeParse(dto).success, true);
  assert.equal(toInboxItemDto({ ...baseRow, readAt: READ }).readAt, "2026-09-21T05:00:00.000Z");
});

test("toInboxDetailDto: menyertakan pengumuman lengkap atau null", () => {
  const row = { ...baseRow, type: "ANNOUNCEMENT" as const, category: "EVENT" as const, announcementId: "a1" };
  const announcement = { id: "a1", category: "EVENT" as const, title: "Pentas seni", body: "Isi lengkap pengumuman.", publishedAt: CREATED };
  const detail = toInboxDetailDto(row, announcement);
  assert.deepEqual(detail.announcement, { ...announcement, publishedAt: "2026-09-21T01:02:03.004Z" });
  assert.equal(inboxDetailSchema.safeParse(detail).success, true);
  const personal = toInboxDetailDto(baseRow, null);
  assert.equal(personal.announcement, null);
  assert.equal(inboxDetailSchema.safeParse(personal).success, true);
  assert.equal(toInboxDetailDto(row, { ...announcement, publishedAt: null }).announcement?.publishedAt, null);
});

test("toUnreadCountDto: latestCreatedAt ISO atau null; lolos skema", () => {
  const dto = toUnreadCountDto({ total: 4, announcements: 1, personal: 3, latestCreatedAt: CREATED });
  assert.deepEqual(dto, { total: 4, announcements: 1, personal: 3, latestCreatedAt: "2026-09-21T01:02:03.004Z" });
  assert.equal(unreadCountSchema.safeParse(dto).success, true);
  assert.equal(toUnreadCountDto({ total: 0, announcements: 0, personal: 0, latestCreatedAt: null }).latestCreatedAt, null);
});
