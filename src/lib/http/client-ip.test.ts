import { test } from "node:test";
import assert from "node:assert/strict";
import { clientIp, rateLimitKeyForIp } from "./client-ip";

function req(headers: Record<string, string>): Request {
  return new Request("http://127.0.0.1:3030/api/v1/auth/login", { headers });
}

test("clientIp memakai X-Real-IP", () => {
  assert.equal(clientIp(req({ "x-real-ip": "203.0.113.7" })), "203.0.113.7");
  assert.equal(clientIp(req({ "x-real-ip": "  203.0.113.7 " })), "203.0.113.7");
  assert.equal(clientIp(req({ "x-real-ip": "2001:db8::1" })), "2001:db8::1");
});

test("clientIp mengabaikan X-Forwarded-For palsu sepenuhnya", () => {
  const forged = req({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "1.1.1.1, 2.2.2.2" });
  assert.equal(clientIp(forged), "203.0.113.7");
  assert.equal(clientIp(req({ "x-forwarded-for": "1.1.1.1" })), null);
  assert.equal(clientIp(req({ forwarded: "for=1.1.1.1" })), null);
});

test("clientIp null bila header hilang atau tidak valid", () => {
  assert.equal(clientIp(req({})), null);
  for (const bad of ["", "   ", "not-an-ip", "1.2.3.4:80", "[::1]", "01.2.3.4", "1.2.3.4, 5.6.7.8", "256.1.1.1", "a".repeat(300)]) {
    assert.equal(clientIp(req({ "x-real-ip": bad })), null, bad);
  }
});

test("rateLimitKeyForIp: IPv4 apa adanya", () => {
  assert.equal(rateLimitKeyForIp("203.0.113.7"), "203.0.113.7");
});

test("rateLimitKeyForIp: IPv4-mapped IPv6 menjadi IPv4", () => {
  assert.equal(rateLimitKeyForIp("::ffff:1.2.3.4"), "1.2.3.4");
  assert.equal(rateLimitKeyForIp("::FFFF:1.2.3.4"), "1.2.3.4");
  assert.equal(rateLimitKeyForIp("::ffff:102:304"), "1.2.3.4");
  assert.equal(rateLimitKeyForIp("0:0:0:0:0:ffff:c0a8:0101"), "192.168.1.1");
});

test("rateLimitKeyForIp: IPv6 dinormalisasi ke prefiks /64", () => {
  const key = "2001:db8:abcd:12::/64";
  assert.equal(rateLimitKeyForIp("2001:db8:abcd:12::1"), key);
  assert.equal(rateLimitKeyForIp("2001:0DB8:ABCD:0012:0000:0000:0000:0001"), key);
  assert.equal(rateLimitKeyForIp("2001:db8:abcd:12:ffff:ffff:ffff:ffff"), key);
  assert.equal(rateLimitKeyForIp("2001:db8:abcd:12:1:2:3.4.5.6"), key);
  assert.notEqual(rateLimitKeyForIp("2001:db8:abcd:13::1"), key);
});

test("rateLimitKeyForIp: bentuk :: di awal/akhir dan zona", () => {
  assert.equal(rateLimitKeyForIp("::1"), "0:0:0:0::/64");
  assert.equal(rateLimitKeyForIp("::"), "0:0:0:0::/64");
  assert.equal(rateLimitKeyForIp("2001:db8::"), "2001:db8:0:0::/64");
  assert.equal(rateLimitKeyForIp("fe80::1%eth0"), "fe80:0:0:0::/64");
});

test("rateLimitKeyForIp: null atau string bukan IP menjadi 'unknown'", () => {
  assert.equal(rateLimitKeyForIp(null), "unknown");
  assert.equal(rateLimitKeyForIp("bukan-ip"), "unknown");
});

test("clientIp + rateLimitKeyForIp: rotasi alamat dalam satu /64 memakai key yang sama", () => {
  const keys = new Set(
    ["2001:db8:1:2::a", "2001:db8:1:2::b", "2001:db8:1:2:dead:beef:0:1"].map((ip) =>
      rateLimitKeyForIp(clientIp(req({ "x-real-ip": ip }))),
    ),
  );
  assert.equal(keys.size, 1);
});
