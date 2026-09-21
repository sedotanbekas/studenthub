import { test } from "node:test";
import assert from "node:assert/strict";
import { PLACEHOLDER_STATUS, placeholderHandler } from "./placeholders";
import { JOB_HANDLERS } from "./registry";
import { JOB_NAMES, isJobName } from "./types";

const NOW = new Date("2026-09-21T19:00:00Z");
const CTX = { now: NOW, requestId: "req-registry", deadline: NOW.getTime() + 50_000 };

test("JOB_HANDLERS: tepat satu handler untuk setiap JobName", () => {
  assert.deepEqual(Object.keys(JOB_HANDLERS).sort(), [...JOB_NAMES].sort());
  for (const name of JOB_NAMES) assert.equal(typeof JOB_HANDLERS[name], "function", name);
});

test("placeholderHandler mengembalikan status belum-diimplementasi (objek baru tiap panggilan)", async () => {
  assert.equal(PLACEHOLDER_STATUS, "belum-diimplementasi");
  const a = await placeholderHandler(CTX);
  const b = await placeholderHandler(CTX);
  assert.deepEqual(a, { status: "belum-diimplementasi" });
  assert.notEqual(a, b);
});

test("semua handler P0 masih placeholder yang aman dijalankan", async () => {
  for (const name of JOB_NAMES) {
    assert.deepEqual(await JOB_HANDLERS[name](CTX), { status: "belum-diimplementasi" }, name);
  }
});

test("isJobName: hanya nama job terdaftar ('tick' bukan job)", () => {
  for (const name of JOB_NAMES) assert.equal(isJobName(name), true, name);
  for (const other of ["tick", "", "PUSH-DISPATCH", "push-receipts", "__proto__", "constructor"]) {
    assert.equal(isJobName(other), false, other);
  }
});
