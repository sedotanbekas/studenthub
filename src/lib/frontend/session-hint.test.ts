import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_HINT, SESSION_HINT, demoHintCookie, initialSessionView, readSessionHint } from "./session-hint";

const jar = (cookies: Record<string, string>) => (name: string) => cookies[name];

test("petunjuk sesi dibaca dari cookie penanda, bukan dari token", () => {
  assert.deepEqual(readSessionHint(jar({})), { account: false, demo: false });
  assert.deepEqual(readSessionHint(jar({ [SESSION_HINT]: "1" })), { account: true, demo: false });
  assert.deepEqual(readSessionHint(jar({ [DEMO_HINT]: "1" })), { account: false, demo: true });
  // Nilai lain (kosong / dihapus) = tidak ada penanda.
  assert.deepEqual(readSessionHint(jar({ [SESSION_HINT]: "", [DEMO_HINT]: "0" })), { account: false, demo: false });
});

test("tanpa penanda apa pun halaman masuk langsung dirender server; ada penanda -> memuat sesi dulu", () => {
  assert.equal(initialSessionView({ account: false, demo: false }), "login");
  assert.equal(initialSessionView({ account: true, demo: false }), "loading");
  assert.equal(initialSessionView({ account: false, demo: true }), "loading");
});

test("cookie penanda demo: sesi browser, seluruh situs, Secure hanya di HTTPS", () => {
  assert.equal(demoHintCookie(true, true), `${DEMO_HINT}=1; Path=/; SameSite=Lax; Secure`);
  assert.equal(demoHintCookie(true, false), `${DEMO_HINT}=1; Path=/; SameSite=Lax`);
  assert.equal(demoHintCookie(false, true), `${DEMO_HINT}=; Path=/; Max-Age=0; SameSite=Lax; Secure`);
  assert.doesNotMatch(demoHintCookie(true, true), /Max-Age|Expires/);
});
