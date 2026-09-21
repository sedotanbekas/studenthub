import { test } from "node:test";
import assert from "node:assert/strict";
import { announcementDetailSchema, announcementListItemSchema } from "./schemas";
import { audienceOf, toAnnouncementDetailDto, toAnnouncementListItemDto, type AnnouncementDetailRow } from "./dto";

const AT = new Date("2026-09-21T01:02:03.004Z");

const row: AnnouncementDetailRow = {
  id: "a1",
  category: "EVENT",
  title: "Pentas seni",
  audience: "CLASSES",
  status: "PUBLISHED",
  publishedAt: AT,
  cancelledAt: null,
  recipientCount: 12,
  createdAt: AT,
  updatedAt: AT,
  author: { id: "u1", name: "Admin" },
  body: "Isi lengkap",
  targets: [
    { classId: "c2", studentId: null, schoolClass: { id: "c2", name: "VIII B" }, student: null },
    { classId: "c1", studentId: null, schoolClass: { id: "c1", name: "VII A" }, student: null },
  ],
};

test("list item: instant ISO, tanpa isi, sesuai skema kontrak", () => {
  const dto = toAnnouncementListItemDto(row);
  assert.equal(dto.publishedAt, "2026-09-21T01:02:03.004Z");
  assert.equal(dto.cancelledAt, null);
  assert.equal("body" in dto, false);
  assert.equal(announcementListItemSchema.safeParse(dto).success, true);
});

test("detail: target diurut nama, stats dari recipientCount & readCount", () => {
  const dto = toAnnouncementDetailDto(row, 5);
  assert.deepEqual(dto.targets.classes.map((c) => c.name), ["VII A", "VIII B"]);
  assert.deepEqual(dto.targets.students, []);
  assert.deepEqual(dto.stats, { recipientCount: 12, readCount: 5 });
  assert.equal(announcementDetailSchema.safeParse(dto).success, true);
  const draft = toAnnouncementDetailDto({ ...row, status: "DRAFT", recipientCount: null, publishedAt: null }, 0);
  assert.deepEqual(draft.stats, { recipientCount: 0, readCount: 0 });
});

test("detail: target siswa memuat nama & NIS", () => {
  const student = { classId: null, studentId: "s1", schoolClass: null, student: { id: "s1", nis: "123", user: { name: "Budi" } } };
  const dto = toAnnouncementDetailDto({ ...row, audience: "STUDENTS", targets: [student] }, 0);
  assert.deepEqual(dto.targets.students, [{ id: "s1", name: "Budi", nis: "123" }]);
});

test("kategori di respons apa adanya (enum respons lengkap, defensif)", () => {
  const dto = toAnnouncementListItemDto({ ...row, category: "SYSTEM" });
  assert.equal(dto.category, "SYSTEM");
  assert.equal(announcementListItemSchema.safeParse(dto).success, true);
});

test("audienceOf: id kelas/siswa dari baris target", () => {
  assert.deepEqual(audienceOf(row), { audience: "CLASSES", classIds: ["c2", "c1"], studentIds: [] });
});
