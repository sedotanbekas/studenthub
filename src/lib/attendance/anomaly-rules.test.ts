import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANOMALY_CODES,
  ANOMALY_LABELS,
  ANOMALY_SEVERITY,
  detectAnomalies,
  hasReportableAnomaly,
  isDuplicateSelfie,
  mergeFlags,
  parseFlags,
  type AnomalyInput,
} from "./anomaly-rules";

const NOW = Date.UTC(2091, 2, 5, 0, 30, 0);
const DAY_MS = 86_400_000;
const PHASH = "f0f0f0f0f0f0f0f0";

function input(overrides: Partial<AnomalyInput> = {}): AnomalyInput {
  return {
    nowMs: NOW,
    distanceM: 40,
    radiusM: 150,
    accuracyM: 12,
    locationTimestampMs: NOW - 5_000,
    clientTimeMs: NOW,
    requestDeviceId: "device-aaaa-0001",
    sessionDeviceId: "device-aaaa-0001",
    deviceBoundAtMs: null,
    deviceBeforeBinding: null,
    selfiePhash: PHASH,
    recentSelfiePhashes: [],
    sharedDevice: false,
    ...overrides,
  };
}

const flagsOf = (overrides: Partial<AnomalyInput>) => detectAnomalies(input(overrides));

test("check-in bersih tanpa flag", () => {
  assert.deepEqual(detectAnomalies(input()), []);
});

test("GEOFENCE_TOLERANCE hanya bila jarak > radius", () => {
  assert.deepEqual(flagsOf({ distanceM: 150 }), []);
  assert.deepEqual(flagsOf({ distanceM: 150.5 }), ["GEOFENCE_TOLERANCE"]);
});

test("LOW_ACCURACY > 50 m; PERFECT_ACCURACY <= 1 m", () => {
  assert.deepEqual(flagsOf({ accuracyM: 50 }), []);
  assert.deepEqual(flagsOf({ accuracyM: 50.1 }), ["LOW_ACCURACY"]);
  assert.deepEqual(flagsOf({ accuracyM: 1 }), ["PERFECT_ACCURACY"]);
  assert.deepEqual(flagsOf({ accuracyM: 0 }), ["PERFECT_ACCURACY"]);
  assert.deepEqual(flagsOf({ accuracyM: 1.01 }), []);
});

test("STALE_FIX: umur fix > 60 s", () => {
  assert.deepEqual(flagsOf({ locationTimestampMs: NOW - 60_000 }), []);
  assert.deepEqual(flagsOf({ locationTimestampMs: NOW - 61_000 }), ["STALE_FIX"]);
  assert.deepEqual(flagsOf({ locationTimestampMs: NOW - 180_000 }), ["STALE_FIX"]);
});

test("TIME_INCONSISTENT: fix lebih baru dari waktu kirim > 10 s", () => {
  assert.deepEqual(flagsOf({ locationTimestampMs: NOW + 10_000 }), []);
  assert.deepEqual(flagsOf({ locationTimestampMs: NOW + 11_000 }), ["TIME_INCONSISTENT"]);
});

test("CLOCK_SKEW: |clientTime - server| > 300 s (dua arah)", () => {
  const skew = (ms: number) => flagsOf({ clientTimeMs: NOW + ms, locationTimestampMs: NOW + ms - 5_000 });
  assert.deepEqual(skew(300_000), []);
  assert.deepEqual(skew(301_000), ["CLOCK_SKEW"]);
  assert.deepEqual(skew(-301_000), ["CLOCK_SKEW"]);
});

test("DEVICE_SESSION_MISMATCH hanya bila sesi punya deviceId dan berbeda", () => {
  assert.deepEqual(flagsOf({ sessionDeviceId: "device-bbbb-0002" }), ["DEVICE_SESSION_MISMATCH"]);
  assert.deepEqual(flagsOf({ sessionDeviceId: null }), []);
});

test("NEW_DEVICE: perangkat diikat ulang <= 7 hari lalu dan check-in sebelumnya dari perangkat lain", () => {
  const changed = { deviceBoundAtMs: NOW - 7 * DAY_MS, deviceBeforeBinding: "device-lama-0009" };
  assert.deepEqual(flagsOf(changed), ["NEW_DEVICE"]);
  assert.deepEqual(flagsOf({ ...changed, deviceBoundAtMs: NOW - 7 * DAY_MS - 1 }), []);
  assert.deepEqual(flagsOf({ ...changed, deviceBeforeBinding: null }), [], "pengikatan pertama bukan perangkat baru");
  assert.deepEqual(flagsOf({ ...changed, deviceBeforeBinding: "device-aaaa-0001" }), [], "kembali ke perangkat yang sama");
});

test("DUPLICATE_SELFIE: dHash hamming <= 6 terhadap selfie sendiri", () => {
  assert.equal(isDuplicateSelfie(PHASH, ["f0f0f0f0f0f0f0ff"]), true);
  assert.equal(isDuplicateSelfie(PHASH, ["0f0f0f0f0f0f0f0f"]), false);
  assert.equal(isDuplicateSelfie(null, [PHASH]), false);
  assert.deepEqual(flagsOf({ recentSelfiePhashes: ["0f0f0f0f0f0f0f0f", "f0f0f0f0f0f0f03f"] }), ["DUPLICATE_SELFIE"]);
});

test("SHARED_DEVICE dari bukti lintas siswa", () => {
  assert.deepEqual(flagsOf({ sharedDevice: true }), ["SHARED_DEVICE"]);
});

test("flag terurut unik; hasAnomaly hanya untuk MEDIUM/HIGH", () => {
  const flags = flagsOf({ distanceM: 160, accuracyM: 60, sharedDevice: true, sessionDeviceId: "device-lain-0003" });
  assert.deepEqual(flags, ["DEVICE_SESSION_MISMATCH", "GEOFENCE_TOLERANCE", "LOW_ACCURACY", "SHARED_DEVICE"]);
  assert.equal(hasReportableAnomaly(flags), true);
  assert.equal(hasReportableAnomaly(["GEOFENCE_TOLERANCE", "LOW_ACCURACY", "STALE_FIX", "CLOCK_SKEW"]), false);
  assert.equal(hasReportableAnomaly(["PERFECT_ACCURACY"]), true);
  assert.equal(hasReportableAnomaly([]), false);
});

test("parseFlags toleran null, sampah, duplikat, dan kode tak dikenal", () => {
  assert.deepEqual(parseFlags(null), []);
  assert.deepEqual(parseFlags("SHARED_DEVICE"), []);
  assert.deepEqual(parseFlags({ a: 1 }), []);
  assert.deepEqual(parseFlags(["SHARED_DEVICE", "X", 3, "LOW_ACCURACY", "SHARED_DEVICE"]), ["LOW_ACCURACY", "SHARED_DEVICE"]);
});

test("mergeFlags menambah tanpa memutasi dan tetap terurut unik", () => {
  const existing = ["STALE_FIX", "CLOCK_SKEW"];
  const merged = mergeFlags(existing, ["SHARED_DEVICE", "CLOCK_SKEW"]);
  assert.deepEqual(merged, ["CLOCK_SKEW", "SHARED_DEVICE", "STALE_FIX"]);
  assert.deepEqual(existing, ["STALE_FIX", "CLOCK_SKEW"]);
});

test("setiap kode punya severity dan label Bahasa Indonesia", () => {
  for (const code of ANOMALY_CODES) {
    assert.ok(["LOW", "MEDIUM", "HIGH"].includes(ANOMALY_SEVERITY[code]), code);
    assert.ok(ANOMALY_LABELS[code].length > 5, code);
  }
  assert.equal(ANOMALY_SEVERITY.SHARED_DEVICE, "HIGH");
  assert.equal(ANOMALY_SEVERITY.DUPLICATE_SELFIE, "HIGH");
  assert.equal(ANOMALY_SEVERITY.NEW_DEVICE, "MEDIUM");
  assert.equal(ANOMALY_SEVERITY.TIME_INCONSISTENT, "MEDIUM");
  assert.equal(ANOMALY_SEVERITY.GEOFENCE_TOLERANCE, "LOW");
});
