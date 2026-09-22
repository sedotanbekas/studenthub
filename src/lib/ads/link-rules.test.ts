import { test } from "node:test";
import assert from "node:assert/strict";
import { isForbiddenScheme, validateAdLink } from "./link-rules";

const APPS = ["shopee", "tokopedia", "whatsapp"];
const reasonOf = (raw: string, type: "EXTERNAL_URL" | "DEEP_LINK" = "EXTERNAL_URL", allow: readonly string[] = APPS) => {
  const result = validateAdLink(raw, type, allow);
  return result.ok ? null : result.reason;
};

test("https diterima dan dikanonikkan (host huruf kecil, spasi tepi dibuang)", () => {
  const result = validateAdLink("  HTTPS://Promo.Example.CO.ID/diskon?x=1  ", "EXTERNAL_URL", APPS);
  assert.deepEqual(result, { ok: true, href: "https://promo.example.co.id/diskon?x=1", host: "promo.example.co.id", isPunycodeHost: false });
});

test("skema berbahaya & http ditolak, termasuk huruf besar dan spasi di depan", () => {
  for (const raw of [
    "http://example.com", "javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,<b>x</b>", "vbscript:msgbox(1)",
    "file:///etc/passwd", "blob:https://example.com/x", "intent://scan/#Intent;scheme=zxing;end", "java%0Ascript:alert(1)",
  ]) {
    assert.notEqual(reasonOf(raw), null, raw);
  }
});

test("userinfo, literal IP, localhost, host tanpa titik, spasi/kontrol di tengah, dan panjang > 2000 ditolak", () => {
  assert.equal(reasonOf("https://bank.co.id@evil.com/"), "USERINFO");
  assert.equal(reasonOf("https://127.0.0.1/x"), "HOST");
  assert.equal(reasonOf("https://0x7f.1/x"), "HOST");
  assert.equal(reasonOf("https://[::1]/x"), "HOST");
  assert.equal(reasonOf("https://localhost/x"), "HOST");
  assert.equal(reasonOf("https://intranet/x"), "HOST");
  assert.equal(reasonOf("https://exa mple.com/"), "CHARS");
  assert.equal(reasonOf("https://example.com/\u0000"), "CHARS");
  assert.equal(reasonOf(`https://example.com/${"a".repeat(2000)}`), "LENGTH");
  assert.equal(reasonOf("bukan url"), "CHARS");
  assert.equal(reasonOf("tanpa-skema.example.com"), "PARSE");
});

test("host IDN ditandai punycode untuk reviewer", () => {
  const result = validateAdLink("https://tokopédia.com/promo", "EXTERNAL_URL", APPS);
  assert.equal(result.ok && result.isPunycodeHost, true);
  assert.equal(result.ok && result.host.startsWith("xn--"), true);
});

test("deep link: hanya skema di allowlist; skema terlarang tetap ditolak walau di allowlist", () => {
  const ok = validateAdLink("shopee://product/123?ref=sh", "DEEP_LINK", APPS);
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.href, "shopee://product/123?ref=sh");
  assert.equal(reasonOf("lazada://product/1", "DEEP_LINK"), "SCHEME");
  assert.equal(reasonOf("https://shopee.co.id/x", "DEEP_LINK"), "SCHEME");
  assert.equal(reasonOf("intent://x", "DEEP_LINK", [...APPS, "intent"]), "SCHEME");
  assert.equal(reasonOf("javascript:alert(1)", "DEEP_LINK", ["javascript"]), "SCHEME");
  assert.equal(reasonOf("shopee://user:pw@product/1", "DEEP_LINK"), "USERINFO");
});

test("URL eksternal tidak boleh memakai skema aplikasi", () => {
  assert.equal(reasonOf("shopee://product/1", "EXTERNAL_URL"), "SCHEME");
});

test("daftar skema terlarang", () => {
  for (const scheme of ["javascript", "data", "intent", "http", "https", "file", "vbscript", "blob", "about"]) {
    assert.equal(isForbiddenScheme(scheme), true, scheme);
  }
  assert.equal(isForbiddenScheme("shopee"), false);
});
