import { test } from "node:test";
import assert from "node:assert/strict";
import { getLastTickAt, recordTick } from "./heartbeat";

test("getLastTickAt: null sebelum tick pertama", () => {
  assert.equal(getLastTickAt(), null);
});

test("recordTick lalu getLastTickAt: mengembalikan salinan instant tick terakhir", () => {
  const first = new Date("2026-09-21T19:00:00Z");
  recordTick(first);
  recordTick(new Date("2026-09-21T19:01:00Z"));
  const last = getLastTickAt();
  assert.deepEqual(last, new Date("2026-09-21T19:01:00Z"));
  last?.setTime(0);
  assert.deepEqual(getLastTickAt(), new Date("2026-09-21T19:01:00Z"));
});
