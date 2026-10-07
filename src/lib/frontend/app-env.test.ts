import assert from "node:assert/strict";
import test from "node:test";
import { APP_ENVS, appEnvOfHost, demoAllowed, envSwitchMode, switchEnvUrl } from "./app-env";

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

test("produksi bersih untuk klien: sakelar hanya untuk super admin; staging selalu punya jalan kembali", () => {
  assert.equal(envSwitchMode("production", null), "none", "halaman masuk produksi tanpa sakelar");
  assert.equal(envSwitchMode("production", "SCHOOL_ADMIN"), "none");
  assert.equal(envSwitchMode("production", "STUDENT"), "none");
  assert.equal(envSwitchMode("production", "SUPER_ADMIN"), "none", "produksi bersih: tanpa tautan ke staging");
  assert.equal(envSwitchMode("staging", null), "back-to-production");
  assert.equal(envSwitchMode("staging", "STUDENT"), "back-to-production");
  assert.equal(envSwitchMode(null, "SUPER_ADMIN"), "none", "lokal/test tanpa sakelar");
});

test("mode demo (tombol persona) hanya di luar produksi", () => {
  assert.equal(demoAllowed("production"), false);
  assert.equal(demoAllowed("staging"), true);
  assert.equal(demoAllowed(null), true, "lokal/test tetap bisa demo");
});
