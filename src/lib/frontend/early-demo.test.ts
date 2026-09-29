import assert from "node:assert/strict";
import test from "node:test";
import { EARLY_DEMO, earlyDemoCapture, earlyDemoScript, takeEarlyDemo } from "./early-demo";

type Listener = (event: { target: unknown }) => void;
/** document tiruan: menyimpan listener klik fase capture. */
function fakeDocument() {
  const listeners: Listener[] = [];
  return { listeners, addEventListener: (type: string, listener: Listener, capture: boolean) => { if (type === "click" && capture) listeners.push(listener); } };
}
const button = (persona: string | null) => ({ closest: (selector: string) => (selector === `[${EARLY_DEMO.attribute}]` && persona ? { getAttribute: () => persona } : null) });

test("earlyDemoCapture: ketukan tombol demo SEBELUM hidrasi dicatat (yang terakhir menang)", () => {
  const doc = fakeDocument(); const store: Record<string, unknown> = {};
  earlyDemoCapture(doc, store, EARLY_DEMO.attribute, EARLY_DEMO.key, EARLY_DEMO.hydrated);
  doc.listeners[0]!({ target: button("STUDENT") });
  doc.listeners[0]!({ target: button("SPONSOR") });
  assert.equal(store[EARLY_DEMO.key], "SPONSOR");
});

test("earlyDemoCapture: setelah hidrasi / klik di luar tombol demo / target tanpa closest -> diabaikan", () => {
  const doc = fakeDocument(); const store: Record<string, unknown> = {};
  earlyDemoCapture(doc, store, EARLY_DEMO.attribute, EARLY_DEMO.key, EARLY_DEMO.hydrated);
  doc.listeners[0]!({ target: button(null) });
  doc.listeners[0]!({ target: null });
  doc.listeners[0]!({ target: { nodeType: 3 } });
  assert.equal(store[EARLY_DEMO.key], undefined);
  store[EARLY_DEMO.hydrated] = true;
  doc.listeners[0]!({ target: button("STUDENT") });
  assert.equal(store[EARLY_DEMO.key], undefined, "React sudah menangani klik");
});

test("takeEarlyDemo: diambil sekali, hanya kunci persona yang dikenal, menandai sudah terhidrasi", () => {
  const store: Record<string, unknown> = { [EARLY_DEMO.key]: "STUDENT" };
  assert.equal(takeEarlyDemo(store, ["STUDENT", "SPONSOR"]), "STUDENT");
  assert.equal(store[EARLY_DEMO.hydrated], true);
  assert.equal(takeEarlyDemo(store, ["STUDENT"]), null, "tidak dijalankan dua kali");
  assert.equal(takeEarlyDemo({ [EARLY_DEMO.key]: "HACKER" }, ["STUDENT"]), null);
  assert.equal(takeEarlyDemo({ [EARLY_DEMO.key]: 42 }, ["STUDENT"]), null);
});

test("earlyDemoScript: skrip sebaris mandiri yang memasang pencatat yang sama; galat ditelan", () => {
  const doc = fakeDocument(); const store: Record<string, unknown> = {};
  new Function("document", "window", earlyDemoScript())(doc, store);
  doc.listeners[0]!({ target: button("SUPER_ADMIN") });
  assert.equal(store[EARLY_DEMO.key], "SUPER_ADMIN");
  assert.doesNotThrow(() => new Function("document", "window", earlyDemoScript())(null, null));
});
