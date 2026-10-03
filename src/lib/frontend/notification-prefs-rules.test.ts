import { test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN_MUTABLE_CATEGORIES } from "@/lib/notifications/rules";
import { CATEGORY_HINTS, prefsSavedMessage, prefsSummary, toggleMuted } from "./notification-prefs-rules";

test("prefsSummary: tiga bentuk kalimat", () => {
  assert.equal(prefsSummary([]), "Semua kabar sekolah dikirim ke akun ini.");
  assert.equal(prefsSummary(["FINANCE"]), "Kabar Keuangan tidak dikirim ke akun ini.");
  assert.equal(prefsSummary(["STUDENT_AFFAIRS", "FINANCE"]), "Kabar Keuangan dan Kesiswaan tidak dikirim ke akun ini.");
  assert.equal(prefsSavedMessage(["FINANCE"]), "Tersimpan. Kabar Keuangan tidak dikirim ke akun ini.");
});

test("toggleMuted: dicentang = terima; idempoten; urutan kanonik", () => {
  assert.deepEqual(toggleMuted([], "FINANCE", false), ["FINANCE"]);
  assert.deepEqual(toggleMuted(["FINANCE"], "FINANCE", false), ["FINANCE"]);
  assert.deepEqual(toggleMuted(["STUDENT_AFFAIRS"], "FINANCE", false), ["FINANCE", "STUDENT_AFFAIRS"]);
  assert.deepEqual(toggleMuted(["FINANCE", "STUDENT_AFFAIRS"], "FINANCE", true), ["STUDENT_AFFAIRS"]);
  assert.deepEqual(toggleMuted([], "FINANCE", true), []);
});

test("setiap kategori yang bisa diatur punya petunjuk", () => {
  assert.deepEqual(Object.keys(CATEGORY_HINTS).sort(), [...ADMIN_MUTABLE_CATEGORIES].sort());
});
