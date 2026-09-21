import { test } from "node:test";
import assert from "node:assert/strict";
import { kickPushDispatch, registerPushDispatcher } from "./kick";

test("kick tanpa dispatcher terdaftar: no-op; setelah terdaftar: memanggil dispatcher terakhir (lewat globalThis)", async () => {
  await kickPushDispatch();
  const calls: string[] = [];
  registerPushDispatcher(async () => {
    calls.push("a");
  });
  registerPushDispatcher(async () => {
    calls.push("b");
  });
  await kickPushDispatch();
  assert.deepEqual(calls, ["b"]);
  assert.equal(typeof (globalThis as Record<string, unknown>).__studenthubPushDispatcher, "function");
});
