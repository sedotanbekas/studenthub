import { test } from "node:test";
import assert from "node:assert/strict";
import { announcementsContracts } from "./contracts";

test("setiap kontrak pengumuman memakai aksi POLICY domain announcements", () => {
  for (const c of announcementsContracts) assert.match(String(c.action), /^announcements\.(read|manage)$/, c.id);
});

test("setiap route /school/announcements* menerima ?schoolId= untuk super admin", () => {
  for (const c of announcementsContracts) {
    const shape = (c.query as { shape?: Record<string, unknown> } | undefined)?.shape ?? {};
    assert.ok("schoolId" in shape, c.id);
  }
});

test("mutasi memakai announcements.manage; baca & pratinjau memakai announcements.read", () => {
  const byId = new Map(announcementsContracts.map((c) => [c.id, c.action]));
  assert.equal(byId.get("listSchoolAnnouncements"), "announcements.read");
  assert.equal(byId.get("getSchoolAnnouncement"), "announcements.read");
  assert.equal(byId.get("previewSchoolAnnouncementRecipients"), "announcements.read");
  for (const id of ["createSchoolAnnouncement", "updateSchoolAnnouncement", "deleteSchoolAnnouncement", "publishSchoolAnnouncement", "cancelSchoolAnnouncement"]) {
    assert.equal(byId.get(id), "announcements.manage", id);
  }
});
