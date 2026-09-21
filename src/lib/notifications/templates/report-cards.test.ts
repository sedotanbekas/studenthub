import { test } from "node:test";
import assert from "node:assert/strict";
import { reportCardPublishedNotification } from "./report-cards";

test("rapor terbit pertama kali: judul 'Rapor terbit', tautan ke rapor", () => {
  const event = reportCardPublishedNotification({ reportCardId: "rc_1", termLabel: "Semester Ganjil 2026/2027", republished: false });
  assert.equal(event.type, "REPORT_CARD_PUBLISHED");
  assert.equal(event.title, "Rapor terbit");
  assert.match(event.body, /Semester Ganjil 2026\/2027/);
  assert.deepEqual(event.link, { screen: "report-card", id: "rc_1" });
});

test("terbit ulang setelah ditarik: judul 'Rapor diperbarui'", () => {
  const event = reportCardPublishedNotification({ reportCardId: "rc_2", termLabel: "Semester Genap 2026/2027", republished: true });
  assert.equal(event.title, "Rapor diperbarui");
  assert.match(event.body, /diperbarui/);
  assert.deepEqual(event.link, { screen: "report-card", id: "rc_2" });
});
