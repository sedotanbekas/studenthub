import { test } from "node:test";
import assert from "node:assert/strict";
import { announcementPublishedNotification } from "./announcements";

test("pengumuman terbit: tipe ANNOUNCEMENT, kategori pengumuman, deep link & announcementId", () => {
  const event = announcementPublishedNotification({ id: "a1", category: "CALENDAR", title: "Libur semester", body: "Sekolah libur mulai 22 Desember." });
  assert.deepEqual(event, {
    type: "ANNOUNCEMENT",
    category: "CALENDAR",
    title: "Libur semester",
    body: "Sekolah libur mulai 22 Desember.",
    link: { screen: "announcement", id: "a1" },
    announcementId: "a1",
  });
});
