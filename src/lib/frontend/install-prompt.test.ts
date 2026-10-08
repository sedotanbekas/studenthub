import { test } from "node:test";
import assert from "node:assert/strict";
import { createInstallPromptStore } from "./install-prompt";

/** Tiruan BeforeInstallPromptEvent Chromium: prompt() sekali pakai + userChoice. */
function promptEvent(outcome: "accepted" | "dismissed", options: { fail?: boolean } = {}) {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  const calls = { prompt: 0 };
  Object.assign(event, {
    prompt: async () => { calls.prompt += 1; if (options.fail) throw new Error("NotAllowedError"); },
    userChoice: Promise.resolve({ outcome, platform: "web" }),
  });
  return { event, calls };
}

test("beforeinstallprompt ditahan (infobar bawaan tidak muncul) -> ready; prompt() memakai event asli -> accepted -> installed", async () => {
  const target = new EventTarget();
  const store = createInstallPromptStore(target);
  const seen: string[] = [];
  store.subscribe(() => seen.push(store.getSnapshot()));
  assert.equal(store.getSnapshot(), "none");
  const { event, calls } = promptEvent("accepted");
  target.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(store.getSnapshot(), "ready");
  assert.equal(await store.prompt(), "accepted");
  assert.equal(calls.prompt, 1);
  assert.equal(store.getSnapshot(), "installed");
  assert.deepEqual(seen, ["ready", "none", "installed"]);
});

test("ditolak -> event habis dipakai (none); prompt() berikutnya -> unavailable sampai browser menawarkan lagi", async () => {
  const target = new EventTarget();
  const store = createInstallPromptStore(target);
  const { event, calls } = promptEvent("dismissed");
  target.dispatchEvent(event);
  assert.equal(await store.prompt(), "dismissed");
  assert.equal(store.getSnapshot(), "none");
  assert.equal(await store.prompt(), "unavailable");
  assert.equal(calls.prompt, 1);
  target.dispatchEvent(promptEvent("accepted").event);
  assert.equal(store.getSnapshot(), "ready");
});

test("appinstalled (dipasang lewat menu browser) -> installed; berhenti berlangganan tidak dipanggil lagi", () => {
  const target = new EventTarget();
  const store = createInstallPromptStore(target);
  let count = 0;
  const unsubscribe = store.subscribe(() => { count += 1; });
  target.dispatchEvent(promptEvent("accepted").event);
  target.dispatchEvent(new Event("appinstalled"));
  assert.equal(store.getSnapshot(), "installed");
  assert.equal(count, 2);
  unsubscribe();
  target.dispatchEvent(promptEvent("accepted").event);
  assert.equal(count, 2);
});

test("prompt() tanpa tawaran atau prompt asli gagal -> unavailable, tanpa melempar", async () => {
  const target = new EventTarget();
  const store = createInstallPromptStore(target);
  assert.equal(await store.prompt(), "unavailable");
  target.dispatchEvent(promptEvent("accepted", { fail: true }).event);
  assert.equal(await store.prompt(), "unavailable");
  assert.equal(store.getSnapshot(), "none");
});
