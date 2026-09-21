import { test } from "node:test";
import assert from "node:assert/strict";
import { nisnReleasedNotification } from "./students";

test("satu NISN dilepas: tautan ke siswa sekolah asal, tanpa menyebut sekolah baru", () => {
  const event = nisnReleasedNotification([{ studentId: "stu_1", name: "Budi", nisn: "0012345678" }]);
  assert.equal(event.type, "NISN_RELEASED");
  assert.deepEqual(event.link, { screen: "student", id: "stu_1" });
  assert.match(event.body, /0012345678/);
  assert.match(event.body, /sekolah lain/);
});

test("banyak NISN dilepas: ringkasan dengan jumlah, tanpa tautan", () => {
  const released = Array.from({ length: 7 }, (_, i) => ({ studentId: `s${i}`, name: `Siswa ${i}`, nisn: `001234567${i}` }));
  const event = nisnReleasedNotification(released);
  assert.match(event.title, /^7 NISN/);
  assert.match(event.body, /2 lainnya/);
  assert.equal(event.link, undefined);
});
