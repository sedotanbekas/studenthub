import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBasicAuth, guardDocs } from "./basic-auth";

const header = (value: string) => `Basic ${Buffer.from(value).toString("base64")}`;

test("checkBasicAuth menerima kredensial benar dan menolak yang lain", () => {
  assert.equal(checkBasicAuth(header("ci:rahasia-panjang"), "ci:rahasia-panjang"), true);
  assert.equal(checkBasicAuth(header("ci:salah"), "ci:rahasia-panjang"), false);
  assert.equal(checkBasicAuth("Bearer abc", "ci:rahasia-panjang"), false);
  assert.equal(checkBasicAuth(null, "ci:rahasia-panjang"), false);
});

test("guardDocs terbuka tanpa konfigurasi dan menantang bila salah", () => {
  const req = new Request("http://x/docs");
  assert.equal(guardDocs(req, undefined), null);
  const challenge = guardDocs(req, "ci:rahasia-panjang");
  assert.equal(challenge?.status, 401);
  assert.match(challenge?.headers.get("www-authenticate") ?? "", /Basic/);
  const okReq = new Request("http://x/docs", { headers: { authorization: header("ci:rahasia-panjang") } });
  assert.equal(guardDocs(okReq, "ci:rahasia-panjang"), null);
});
