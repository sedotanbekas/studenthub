import { test } from "node:test";
import assert from "node:assert/strict";
import { IMPRESSION_BATCH_MAX, deviceTypeOf, enqueueImpression, isRetryableImpressionError, refreshDelaySeconds, safeTargetUrl, takeBatch, wrapIndex } from "./ad-slot-rules";

test("enqueueImpression: token yang sudah antre atau sudah terkirim tidak diantrekan ulang", () => {
  const sent = new Set(["a"]);
  assert.deepEqual(enqueueImpression([], sent, "b"), ["b"]);
  assert.deepEqual(enqueueImpression(["b"], sent, "b"), ["b"]);
  assert.deepEqual(enqueueImpression(["b"], sent, "a"), ["b"]);
});

test("takeBatch mengambil paling banyak 20 token (batas API), sisanya tetap antre", () => {
  const queue = Array.from({ length: 25 }, (_, i) => `t${i}`);
  const { batch, rest } = takeBatch(queue);
  assert.equal(batch.length, IMPRESSION_BATCH_MAX);
  assert.deepEqual(rest, ["t20", "t21", "t22", "t23", "t24"]);
  assert.deepEqual(takeBatch([]), { batch: [], rest: [] });
});

test("deviceTypeOf: ponsel, tablet, atau komputer dari user agent & lebar layar", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
  const android = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36";
  const androidTablet = "Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 Chrome/128.0 Safari/537.36";
  const ipad = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
  const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36";
  assert.equal(deviceTypeOf(iphone, 390), "MOBILE");
  assert.equal(deviceTypeOf(android, 412), "MOBILE");
  assert.equal(deviceTypeOf(androidTablet, 800), "TABLET");
  assert.equal(deviceTypeOf(ipad, 820), "TABLET");
  assert.equal(deviceTypeOf(windows, 1440), "DESKTOP");
  assert.equal(deviceTypeOf(windows, 500), "MOBILE", "jendela sempit dianggap ponsel");
});

test("deviceTypeOf: iPad modern (mengaku Macintosh) dengan layar sentuh = tablet", () => {
  const ipadOs = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";
  assert.equal(deviceTypeOf(ipadOs, 1024, 5), "TABLET");
  assert.equal(deviceTypeOf(ipadOs, 1440, 0), "DESKTOP", "Mac tanpa layar sentuh tetap komputer");
});

test("impresi gagal: galat jaringan/server/batas laju dicoba ulang; galat validasi dibuang", () => {
  for (const code of [null, "NETWORK", "WEB_SESSION", "RATE_LIMITED", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR", "UNKNOWN", "CONFLICT_RETRY"]) assert.equal(isRetryableImpressionError(code), true, String(code));
  for (const code of ["VALIDATION_FAILED", "UNSUPPORTED_MEDIA_TYPE", "FORBIDDEN", "STUDENT_NOT_ACTIVE"]) assert.equal(isRetryableImpressionError(code), false, code);
});

test("refreshDelaySeconds: jadwal normal dari server; setelah gagal mundur bertahap 60 s .. 30 menit", () => {
  assert.equal(refreshDelaySeconds(1800, 0), 1800);
  assert.equal(refreshDelaySeconds(5, 0), 60, "minimal 60 detik");
  assert.equal(refreshDelaySeconds(null, 1), 60);
  assert.equal(refreshDelaySeconds(null, 2), 120);
  assert.equal(refreshDelaySeconds(null, 10), 1800, "maksimal 30 menit");
});

test("safeTargetUrl: hanya https untuk tautan luar; skema berbahaya selalu ditolak", () => {
  assert.equal(safeTargetUrl("https://cahayailmu.example/tryout", "EXTERNAL_URL"), "https://cahayailmu.example/tryout");
  assert.equal(safeTargetUrl("http://contoh.example", "EXTERNAL_URL"), null);
  assert.equal(safeTargetUrl("javascript:alert(1)", "EXTERNAL_URL"), null);
  assert.equal(safeTargetUrl("javascript:alert(1)", "DEEP_LINK"), null);
  assert.equal(safeTargetUrl("data:text/html,hai", "DEEP_LINK"), null);
  assert.equal(safeTargetUrl("tokoku://produk/12", "DEEP_LINK"), "tokoku://produk/12");
  assert.equal(safeTargetUrl(null, "EXTERNAL_URL"), null);
  assert.equal(safeTargetUrl("bukan url", "EXTERNAL_URL"), null);
  // Deep link memakai daftar skema terlarang yang sama dengan server (http:, ms-settings:, ftp:, ...).
  assert.equal(safeTargetUrl("http://phish.example/login", "DEEP_LINK"), null);
  assert.equal(safeTargetUrl("ms-settings:privacy", "DEEP_LINK"), null);
  assert.equal(safeTargetUrl("HTTPS://Mitra.Example/Promo", "EXTERNAL_URL"), "https://mitra.example/Promo", "bentuk kanonik");
});

test("wrapIndex berputar di kedua arah", () => {
  assert.equal(wrapIndex(0, 3, 1), 1);
  assert.equal(wrapIndex(2, 3, 1), 0);
  assert.equal(wrapIndex(0, 3, -1), 2);
  assert.equal(wrapIndex(0, 0, 1), 0);
});
