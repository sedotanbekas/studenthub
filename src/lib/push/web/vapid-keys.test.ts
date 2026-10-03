import { test } from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { generateVapidKeys, isVapidPrivateKey, isVapidPublicKey } from "./vapid-keys";

const b64url = (bytes: Buffer) => bytes.toString("base64url");

test("kunci hasil generateVapidKeys lolos kedua validator dan tanda tangan ECDSA dengan d terverifikasi dengan kunci publik", () => {
  const keys = generateVapidKeys();
  assert.equal(isVapidPublicKey(keys.publicKey), true);
  assert.equal(isVapidPrivateKey(keys.privateKey), true);
  const pub = Buffer.from(keys.publicKey, "base64url");
  const x = b64url(pub.subarray(1, 33));
  const y = b64url(pub.subarray(33, 65));
  const privateKey = createPrivateKey({ key: { kty: "EC", crv: "P-256", x, y, d: keys.privateKey }, format: "jwk" });
  const publicKey = createPublicKey({ key: { kty: "EC", crv: "P-256", x, y }, format: "jwk" });
  const signature = sign("sha256", Buffer.from("studenthub"), privateKey);
  assert.equal(verify("sha256", Buffer.from("studenthub"), publicKey, signature), true);
  assert.notEqual(generateVapidKeys().privateKey, keys.privateKey, "acak tiap panggilan");
});

test("validator menolak bentuk yang salah", () => {
  const uncompressed = Buffer.alloc(65, 1);
  uncompressed[0] = 0x04;
  assert.equal(isVapidPublicKey(b64url(uncompressed)), true);
  const wrongPrefix = Buffer.from(uncompressed);
  wrongPrefix[0] = 0x02;
  assert.equal(isVapidPublicKey(b64url(wrongPrefix)), false);
  assert.equal(isVapidPublicKey(b64url(Buffer.alloc(64, 4))), false);
  assert.equal(isVapidPublicKey("bukan+base64/url="), false);
  assert.equal(isVapidPublicKey(""), false);
  assert.equal(isVapidPrivateKey(b64url(Buffer.alloc(32, 7))), true);
  assert.equal(isVapidPrivateKey(b64url(Buffer.alloc(31, 7))), false);
  assert.equal(isVapidPrivateKey("a b"), false);
});
