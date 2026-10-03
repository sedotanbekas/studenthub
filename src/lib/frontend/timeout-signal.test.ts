import { test } from "node:test";
import assert from "node:assert/strict";
import { timeoutSignal } from "./timeout-signal";

test("memakai AbortSignal.timeout bila tersedia", (t) => {
  const native = AbortSignal.timeout(1_000);
  t.mock.method(AbortSignal, "timeout", () => native);
  assert.equal(timeoutSignal(1_000), native);
});

test("browser lama tanpa AbortSignal.timeout (Safari < 16, Chrome < 103): tidak melempar, batal setelah ms dengan TimeoutError", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = Object.getOwnPropertyDescriptor(AbortSignal, "timeout");
  Reflect.deleteProperty(AbortSignal, "timeout");
  try {
    const signal = timeoutSignal(5_000);
    assert.equal(signal.aborted, false);
    t.mock.timers.tick(4_999);
    assert.equal(signal.aborted, false);
    t.mock.timers.tick(1);
    assert.equal(signal.aborted, true);
    assert.ok(signal.reason instanceof DOMException);
    assert.equal((signal.reason as DOMException).name, "TimeoutError");
  } finally {
    if (original) Object.defineProperty(AbortSignal, "timeout", original);
  }
});
