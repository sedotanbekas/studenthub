import { test } from "node:test";
import assert from "node:assert/strict";
import { NOTICE_NISNS_SHOWN, nisnReleaseSuperAdminNotice } from "./nisn-release-notice";

const claimer = { id: "school-claimer", name: "SMP Pengklaim" };

test("notifikasi super admin: sekolah pengklaim + NISN, tanpa data pemegang lama", () => {
  const event = nisnReleaseSuperAdminNotice({ claimer, nisns: ["0012345678"] });
  assert.equal(event.type, "NISN_RELEASED");
  assert.equal(event.title, "NISN siswa lulus dilepas");
  assert.match(event.body, /SMP Pengklaim/);
  assert.match(event.body, /0012345678/);
  assert.deepEqual(event.link, { screen: "school", id: "school-claimer" });
});

test("notifikasi super admin massal: NISN dibatasi + ringkasan sisanya", () => {
  const nisns = Array.from({ length: NOTICE_NISNS_SHOWN + 3 }, (_, i) => `00${String(10_000_000 + i)}`);
  const event = nisnReleaseSuperAdminNotice({ claimer, nisns });
  assert.equal(event.title, `${nisns.length} NISN siswa lulus dilepas`);
  assert.match(event.body, /dan 3 lainnya/);
  assert.doesNotMatch(event.body, new RegExp(nisns.at(-1) ?? "x"));
});
