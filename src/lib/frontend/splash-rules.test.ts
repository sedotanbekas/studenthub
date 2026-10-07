import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AWAY_MS, MARK_INSCRIBED, MARK_ORIGIN, PRESENCE_KEY, RESUME_MAX_AGE_MS, SPLASH_MS, awayTooLong, isHexColor, parsePresence, parseResume,
  resumePlan, returnSplashDue, revealDelay, revealZoom, splashBoot, splashBootScript,
} from "./splash-rules";

const NOW = Date.UTC(2026, 8, 28, 3, 0, 0);
const MIN = 60_000;

/** Penyimpanan & <html> tiruan untuk skrip boot. */
function fakes(stored: Record<string, string> = {}, throwing = false) {
  const vars: Record<string, string> = {};
  const storage = { getItem: (key: string) => { if (throwing) throw new Error("diblokir"); return stored[key] ?? null; } };
  const root = { dataset: {} as Record<string, string | undefined>, style: { setProperty: (name: string, value: string) => { vars[name] = value; } } };
  return { storage, root, vars };
}
const presence = (value: unknown) => ({ [PRESENCE_KEY]: JSON.stringify(value) });

test("SPLASH_MS: animasi + transisi masker maksimal 1 detik, baik saat membuka situs maupun setelah login", () => {
  assert.ok(SPLASH_MS.intro + SPLASH_MS.reveal <= 1000);
  assert.ok(SPLASH_MS.wipe + SPLASH_MS.reveal <= 1000);
  assert.ok(SPLASH_MS.holdMax > SPLASH_MS.intro, "penjagaan saat data belum siap lebih lama dari intro");
});

test("SPLASH_MS: logout = login dibalik (masker menutup -> logo -> tirai kembali ke tombol), total <= 1 detik", () => {
  assert.equal(SPLASH_MS.close, SPLASH_MS.reveal, "masker menutup = cermin masker membuka");
  assert.ok(SPLASH_MS.hold > 0);
  assert.ok(SPLASH_MS.close + SPLASH_MS.hold + SPLASH_MS.wipe <= 1000);
});

test("awayTooLong: kembali setelah LEBIH dari 5 menit (walau 1 ms) -> splash; <= 5 menit -> tidak", () => {
  assert.equal(AWAY_MS, 5 * MIN);
  assert.equal(awayTooLong(NOW - 2 * MIN, NOW), false);
  assert.equal(awayTooLong(NOW - 5 * MIN, NOW), false, "tepat 5 menit belum");
  assert.equal(awayTooLong(NOW - 5 * MIN - 1, NOW), true);
  assert.equal(awayTooLong(NOW - 5 * MIN - 1000, NOW), true, "5 menit 1 detik");
  assert.equal(awayTooLong(NOW - 24 * 60 * MIN, NOW), true);
});

test("awayTooLong: belum pernah tercatat / nilai rusak / jam mundur jauh -> dianggap lama pergi", () => {
  assert.equal(awayTooLong(null, NOW), true);
  assert.equal(awayTooLong(undefined, NOW), true);
  assert.equal(awayTooLong(Number.NaN, NOW), true);
  assert.equal(awayTooLong(NOW + 10 * MIN, NOW), true, "tercatat 10 menit di masa depan: jam perangkat diubah");
  assert.equal(awayTooLong(NOW + 20_000, NOW), false, "selisih kecil antartab bukan kepergian");
});

test("parsePresence: hanya bentuk yang sah; warna tema divalidasi hex", () => {
  const tint = { a: "#1e3a8a", b: "#1e43ad", ink: "#ffffff", glow: "#38bdf8" };
  assert.deepEqual(parsePresence(JSON.stringify({ seenAt: NOW, signedIn: true, tint })), { seenAt: NOW, signedIn: true, tint });
  assert.deepEqual(parsePresence(JSON.stringify({ seenAt: NOW, signedIn: false })), { seenAt: NOW, signedIn: false, tint: null });
  assert.deepEqual(parsePresence(JSON.stringify({ seenAt: NOW, signedIn: true, tint: { ...tint, a: "red;}body{" } })), { seenAt: NOW, signedIn: true, tint: null });
  assert.equal(parsePresence(null), null);
  assert.equal(parsePresence("{rusak"), null);
  assert.equal(parsePresence(JSON.stringify({ seenAt: "kemarin", signedIn: true })), null);
  assert.equal(parsePresence(JSON.stringify({ seenAt: NOW })), null);
  assert.equal(parsePresence("null"), null);
});

test("isHexColor: hanya #rrggbb", () => {
  assert.equal(isHexColor("#1d4ed8"), true);
  assert.equal(isHexColor("#FFFFFF"), true);
  assert.equal(isHexColor("#fff"), false);
  assert.equal(isHexColor("url(x)"), false);
  assert.equal(isHexColor(12), false);
});

test("splashBoot: kunjungan pertama (belum ada catatan) -> tanpa splash, halaman masuk langsung tampil", () => {
  const { storage, root, vars } = fakes();
  assert.equal(splashBoot(storage, root, NOW, 12.5, PRESENCE_KEY, AWAY_MS), false);
  assert.deepEqual(root.dataset, {});
  assert.deepEqual(vars, {});
});

test("splashBoot: sudah masuk dan baru pergi <= 5 menit -> tanpa splash, <html> tidak disentuh", () => {
  const { storage, root, vars } = fakes(presence({ seenAt: NOW - 2 * MIN, signedIn: true, tint: { a: "#111111", b: "#222222", ink: "#ffffff", glow: "#333333" } }));
  assert.equal(splashBoot(storage, root, NOW, 1, PRESENCE_KEY, AWAY_MS), false);
  assert.deepEqual(root.dataset, {});
  assert.deepEqual(vars, {});
});

test("splashBoot: sudah masuk tetapi pergi > 5 menit -> splash bertema warna terakhir", () => {
  const { storage, root, vars } = fakes(presence({ seenAt: NOW - 5 * MIN - 1000, signedIn: true, tint: { a: "#111111", b: "#222222", ink: "#fefefe", glow: "#333333" } }));
  assert.equal(splashBoot(storage, root, NOW, 1, PRESENCE_KEY, AWAY_MS), true);
  assert.equal(root.dataset.splash, "intro");
  assert.equal(root.dataset.splashAt, "1");
  assert.deepEqual(vars, { "--splash-a": "#111111", "--splash-b": "#222222", "--splash-ink": "#fefefe", "--splash-glow": "#333333" });
});

test("splashBoot: tamu (belum login) -> tidak pernah splash, baru dibuka maupun lama pergi", () => {
  for (const seenAt of [NOW - 1000, NOW - 60 * MIN]) {
    const { storage, root } = fakes(presence({ seenAt, signedIn: false }));
    assert.equal(splashBoot(storage, root, NOW, 1, PRESENCE_KEY, AWAY_MS), false);
    assert.deepEqual(root.dataset, {});
  }
});

test("splashBoot: catatan rusak / penyimpanan diblokir -> tanpa splash; warna tak sah tidak pernah dipasang", () => {
  const broken = fakes({ [PRESENCE_KEY]: "{rusak" });
  assert.equal(splashBoot(broken.storage, broken.root, NOW, 1, PRESENCE_KEY, AWAY_MS), false);
  const blocked = fakes({}, true);
  assert.equal(splashBoot(blocked.storage, blocked.root, NOW, 1, PRESENCE_KEY, AWAY_MS), false);
  assert.deepEqual(blocked.root.dataset, {});
  const evil = fakes(presence({ seenAt: NOW - 10 * MIN, signedIn: true, tint: { a: "red;}html{display:none", b: "#222222", ink: "#ffffff", glow: "#333333" } }));
  splashBoot(evil.storage, evil.root, NOW, 1, PRESENCE_KEY, AWAY_MS);
  assert.equal(evil.vars["--splash-a"], undefined);
  assert.equal(evil.vars["--splash-b"], "#222222");
});

test("splashBootScript: skrip <script> mandiri (tanpa impor) menjalankan keputusan yang sama", () => {
  const script = splashBootScript();
  assert.ok(script.includes(JSON.stringify(PRESENCE_KEY)));
  const run = (stored: Record<string, string>) => {
    const { storage, root } = fakes(stored);
    new Function("localStorage", "document", "performance", "Date", script)(storage, { documentElement: root }, { now: () => 42 }, { now: () => NOW });
    return root.dataset;
  };
  assert.deepEqual(run({}), {}, "tamu: tanpa splash");
  assert.deepEqual(run(presence({ seenAt: NOW - MIN, signedIn: true })), {});
  assert.deepEqual(run(presence({ seenAt: NOW - 6 * MIN, signedIn: true })), { splash: "intro", splashAt: "42" });
  assert.doesNotThrow(() => new Function("localStorage", "document", "performance", "Date", script)(null, null, null, null), "galat apa pun ditelan: halaman tetap tampil");
});

test("returnSplashDue: kembali ke tab setelah > 5 menit memutar splash hanya untuk yang sudah masuk", () => {
  assert.equal(returnSplashDue(true, NOW - 6 * MIN, NOW), true);
  assert.equal(returnSplashDue(true, NOW - 2 * MIN, NOW), false);
  assert.equal(returnSplashDue(true, null, NOW), true, "tanpa catatan pada akun yang masuk = lama pergi");
  assert.equal(returnSplashDue(false, NOW - 6 * MIN, NOW), false, "tamu di halaman masuk");
  assert.equal(returnSplashDue(false, null, NOW), false);
});

test("parseResume: hanya path bagian hub (tanpa query/host) milik user tertentu", () => {
  const ok = { userId: "u1", path: "/hub/my-bills", y: 420.6, at: NOW };
  assert.deepEqual(parseResume(JSON.stringify(ok)), { userId: "u1", path: "/hub/my-bills", y: 421, at: NOW });
  assert.deepEqual(parseResume(JSON.stringify({ ...ok, path: "/hub" })), { userId: "u1", path: "/hub", y: 421, at: NOW });
  assert.deepEqual(parseResume(JSON.stringify({ ...ok, y: -30 })), { ...ok, y: 0 });
  for (const path of ["https://jahat.example/hub", "//jahat.example", "/hub/../api/web/auth/logout", "/hub/students?x=1", "/api/web/auth/me", "/hub/a/b", "/hubx", "/hub/Students"]) {
    assert.equal(parseResume(JSON.stringify({ ...ok, path })), null, path);
  }
  assert.equal(parseResume(JSON.stringify({ ...ok, userId: "" })), null);
  assert.equal(parseResume(JSON.stringify({ ...ok, at: "kemarin" })), null);
  assert.equal(parseResume("{rusak"), null);
  assert.equal(parseResume(null), null);
});

test("resumePlan: membuka situs (/hub) melanjutkan halaman terakhir + posisi gulirnya", () => {
  const record = { userId: "u1", path: "/hub/my-bills", y: 420, at: NOW - 3 * 24 * 60 * MIN };
  const ctx = { userId: "u1", pathname: "/hub", now: NOW, allowed: () => true };
  assert.deepEqual(resumePlan(record, ctx), { path: "/hub/my-bills", y: 420 });
  assert.deepEqual(resumePlan({ ...record, path: "/hub" }, ctx), { path: "/hub", y: 420 }, "beranda: hanya posisi gulir");
  assert.deepEqual(resumePlan(record, { ...ctx, pathname: "/hub/my-bills" }), { path: "/hub/my-bills", y: 420 }, "muat ulang halaman yang sama: posisi gulir");
  assert.deepEqual(resumePlan(record, { ...ctx, pathname: "/hub/" }), { path: "/hub/my-bills", y: 420 });
});

test("resumePlan: bukan pemilik catatan / terlalu lama / tak diizinkan / membuka halaman lain -> tidak dilanjutkan", () => {
  const record = { userId: "u1", path: "/hub/my-bills", y: 420, at: NOW - MIN };
  const ctx = { userId: "u1", pathname: "/hub", now: NOW, allowed: () => true };
  assert.equal(resumePlan(null, ctx), null);
  assert.equal(resumePlan(record, { ...ctx, userId: "u2" }), null, "akun lain di perangkat yang sama");
  assert.equal(resumePlan({ ...record, at: NOW - RESUME_MAX_AGE_MS - 1 }, ctx), null);
  assert.equal(resumePlan(record, { ...ctx, allowed: path => path !== "/hub/my-bills" }), null, "bagian milik peran lain");
  assert.equal(resumePlan(record, { ...ctx, pathname: "/hub/my-reports" }), null, "tautan langsung ke halaman lain dihormati");
});

test("revealZoom: lubang logo cukup besar menutup seluruh layar di akhir zoom", () => {
  for (const [w, h, size] of [[390, 844, 101], [1440, 1000, 148], [3840, 2160, 148], [320, 568, 96]] as const) {
    const zoom = revealZoom(w, h, size);
    assert.ok(Number.isInteger(zoom));
    assert.ok(zoom * size * MARK_INSCRIBED >= Math.hypot(w, h) / 2, `${w}x${h}`);
  }
  assert.equal(revealZoom(0, 0, 100), 2, "minimal 2");
  assert.equal(revealZoom(800, 600, 0), 2, "ukuran tak sah");
});

test("revealZoom: logo unggahan memakai jari-jari dalamnya sendiri (dijepit >= 0.04)", () => {
  const zoom = revealZoom(1440, 1000, 148, 0.4);
  assert.ok(zoom * 148 * 0.4 >= Math.hypot(1440, 1000) / 2);
  assert.ok(zoom < revealZoom(1440, 1000, 148), "siluet lebih tebal = skala lebih kecil");
  assert.equal(revealZoom(1440, 1000, 148, 0.001), revealZoom(1440, 1000, 148, 0.04));
  assert.equal(revealZoom(1440, 1000, 148, Number.NaN), revealZoom(1440, 1000, 148));
});

test("geometri tanda: pusat zoom + lingkaran dalamnya berada di dalam kanvas logo", () => {
  for (const v of [MARK_ORIGIN.x, MARK_ORIGIN.y]) {
    assert.ok(v - MARK_INSCRIBED >= 0 && v + MARK_INSCRIBED <= 1, `${v}`);
  }
  assert.ok(MARK_INSCRIBED > 0.1 && MARK_INSCRIBED < 0.5);
});

test("revealDelay: sisa waktu intro sebelum masker dibuka", () => {
  assert.equal(revealDelay(1000, 1200, 540), 340);
  assert.equal(revealDelay(1000, 1600, 540), 0);
  assert.equal(revealDelay(Number.NaN, 1600, 540), 0, "waktu mulai tak dikenal -> langsung");
});
