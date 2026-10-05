import assert from "node:assert/strict";
import test from "node:test";
import { remainingMs, remainingText, safeReturnPath } from "./impersonation-view";

const EXPIRES = "2026-10-05T03:30:00.000Z";
const at = (iso: string) => Date.parse(iso);

test("remainingText: menit:detik tersisa; habis = 0:00", () => {
  assert.equal(remainingText(EXPIRES, at("2026-10-05T03:00:02.000Z")), "29:58");
  assert.equal(remainingText(EXPIRES, at("2026-10-05T03:29:51.500Z")), "0:09");
  assert.equal(remainingText(EXPIRES, at("2026-10-05T03:31:00.000Z")), "0:00");
  assert.equal(remainingMs(EXPIRES, at("2026-10-05T03:31:00.000Z")), 0);
});

test("safeReturnPath: hanya alamat di dalam /hub; selain itu ke halaman Pengguna", () => {
  assert.equal(safeReturnPath("/hub/schools/abc?x=1"), "/hub/schools/abc?x=1");
  assert.equal(safeReturnPath("/hub"), "/hub");
  for (const bad of [null, "", "https://jahat.example", "//jahat.example", "/hubx", "/api/web/x", "javascript:alert(1)"]) {
    assert.equal(safeReturnPath(bad), "/hub/users", String(bad));
  }
});
