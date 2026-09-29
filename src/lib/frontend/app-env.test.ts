import assert from "node:assert/strict";
import test from "node:test";
import { APP_ENVS, appEnvOfHost, switchEnvUrl } from "./app-env";

test("lingkungan dikenali dari header Host (domain resmi & alias sslip.io, port diabaikan)", () => {
  assert.equal(appEnvOfHost("studenthub.id"), "production");
  assert.equal(appEnvOfHost("www.studenthub.id"), "production");
  assert.equal(appEnvOfHost("studenthub.38.47.176.211.sslip.io"), "production");
  assert.equal(appEnvOfHost("staging.studenthub.id"), "staging");
  assert.equal(appEnvOfHost("STAGING.studenthub.id:443"), "staging");
  assert.equal(appEnvOfHost("studenthub-demo.38.47.176.211.sslip.io"), "staging");
});

test("host lain (lokal, test, tak dikenal) -> tanpa sakelar lingkungan", () => {
  assert.equal(appEnvOfHost("localhost:3030"), null);
  assert.equal(appEnvOfHost("127.0.0.1:3030"), null);
  assert.equal(appEnvOfHost("evil-studenthub.id"), null);
  assert.equal(appEnvOfHost(""), null);
  assert.equal(appEnvOfHost(null), null);
});

test("pindah lingkungan membuka halaman yang sama di domain lingkungan tujuan", () => {
  const here = { pathname: "/hub/students", search: "?q=budi", hash: "#daftar" };
  assert.equal(switchEnvUrl("staging", here), "https://staging.studenthub.id/hub/students?q=budi#daftar");
  assert.equal(switchEnvUrl("production", here), "https://studenthub.id/hub/students?q=budi#daftar");
});

test("tujuan selalu origin tetap (bukan dari input), sehingga bukan pengalihan terbuka", () => {
  const tricky = { pathname: "//evil.example/x", search: "", hash: "" };
  assert.equal(new URL(switchEnvUrl("staging", tricky)).origin, APP_ENVS.staging.origin);
});
