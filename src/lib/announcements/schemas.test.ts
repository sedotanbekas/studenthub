import { test } from "node:test";
import assert from "node:assert/strict";
import "@/lib/http/zod-setup";
import { createAnnouncementBody, listAnnouncementsQuery, recipientPreviewBody, updateAnnouncementBody } from "./schemas";

const valid = { category: "EVENT", title: "  Pentas Seni  ", body: "Isi", audience: "ALL" };
const pathsOf = (result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } }) =>
  (result.error?.issues ?? []).map((i) => i.path.join("."));

test("create: judul dipangkas, publishNow default false", () => {
  const parsed = createAnnouncementBody.parse(valid);
  assert.equal(parsed.title, "Pentas Seni");
  assert.equal(parsed.publishNow, false);
});

test("create: kategori SYSTEM, judul < 3, isi kosong, field asing ditolak", () => {
  assert.equal(createAnnouncementBody.safeParse({ ...valid, category: "SYSTEM" }).success, false);
  assert.deepEqual(pathsOf(createAnnouncementBody.safeParse({ ...valid, title: " ab " })), ["title"]);
  assert.deepEqual(pathsOf(createAnnouncementBody.safeParse({ ...valid, body: "   " })), ["body"]);
  assert.equal(createAnnouncementBody.safeParse({ ...valid, schoolId: "x" }).success, false);
  assert.equal(createAnnouncementBody.safeParse({ ...valid, body: "x".repeat(5001) }).success, false);
});

test("create: kombinasi audiens/target divalidasi validateAudience", () => {
  assert.deepEqual(pathsOf(createAnnouncementBody.safeParse({ ...valid, classIds: ["c1"] })), ["classIds"]);
  assert.deepEqual(pathsOf(createAnnouncementBody.safeParse({ ...valid, audience: "CLASSES" })), ["classIds"]);
  assert.deepEqual(pathsOf(createAnnouncementBody.safeParse({ ...valid, audience: "STUDENTS", studentIds: ["s"], classIds: ["c"] })), ["classIds"]);
  assert.equal(createAnnouncementBody.safeParse({ ...valid, audience: "CLASSES", classIds: ["c1", "c1"] }).success, true);
  assert.equal(createAnnouncementBody.safeParse({ ...valid, audience: "CLASSES", classIds: [] }).success, false);
});

test("update: minimal satu field; target tanpa audience ditolak", () => {
  assert.equal(updateAnnouncementBody.safeParse({}).success, false);
  assert.equal(updateAnnouncementBody.safeParse({ title: "Judul baru" }).success, true);
  assert.deepEqual(pathsOf(updateAnnouncementBody.safeParse({ classIds: ["c1"] })), ["audience"]);
  assert.equal(updateAnnouncementBody.safeParse({ audience: "STUDENTS", studentIds: ["s1"] }).success, true);
  assert.deepEqual(pathsOf(updateAnnouncementBody.safeParse({ audience: "STUDENTS" })), ["studentIds"]);
});

test("preview & list query", () => {
  assert.equal(recipientPreviewBody.safeParse({ audience: "ALL" }).success, true);
  assert.equal(recipientPreviewBody.safeParse({ audience: "CLASSES" }).success, false);
  const q = listAnnouncementsQuery.parse({ page: "2", status: "DRAFT", q: " 50% " });
  assert.deepEqual({ page: q.page, limit: q.limit, status: q.status, q: q.q }, { page: 2, limit: 20, status: "DRAFT", q: "50%" });
  assert.equal(listAnnouncementsQuery.safeParse({ category: "SYSTEM" }).success, false);
});
