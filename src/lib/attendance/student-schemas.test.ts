import { test } from "node:test";
import assert from "node:assert/strict";
import { checkInBody, historyQuery, precheckBody } from "./student-schemas";

const selfie = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "selfie.jpg", { type: "image/jpeg" });

const form = (overrides: Record<string, unknown> = {}) => ({
  selfie: selfie(),
  latitude: "-6.9147",
  longitude: "107.6098",
  accuracy: "12.5",
  mocked: "false",
  locationTimestamp: "1790000000000",
  clientTime: "1790000005000",
  deviceId: "device-test-0001",
  ...overrides,
});

test("check-in multipart: field teks diubah ke angka/boolean", () => {
  const parsed = checkInBody.parse(form());
  assert.equal(parsed.latitude, -6.9147);
  assert.equal(parsed.longitude, 107.6098);
  assert.equal(parsed.accuracy, 12.5);
  assert.equal(parsed.mocked, false);
  assert.equal(parsed.locationTimestamp, 1790000000000);
  assert.equal(parsed.clientTime, 1790000005000);
});

test("check-in multipart: mocked & accuracy opsional (null / undefined)", () => {
  const { mocked: _m, accuracy: _a, ...rest } = form();
  const parsed = checkInBody.parse(rest);
  assert.equal(parsed.mocked, null);
  assert.equal(parsed.accuracy, undefined);
  assert.equal(checkInBody.parse(form({ mocked: "true" })).mocked, true);
});

test("check-in multipart: string kosong, hex, notasi e, dan di luar rentang ditolak", () => {
  for (const bad of ["", "  ", "0x10", "1e3", "abc", "-91", "91"]) {
    assert.equal(checkInBody.safeParse(form({ latitude: bad })).success, false, `latitude=${JSON.stringify(bad)}`);
  }
  assert.equal(checkInBody.safeParse(form({ longitude: "180.5" })).success, false);
  assert.equal(checkInBody.safeParse(form({ accuracy: "-1" })).success, false);
  assert.equal(checkInBody.safeParse(form({ mocked: "ya" })).success, false);
  assert.equal(checkInBody.safeParse(form({ locationTimestamp: "12.5" })).success, false);
  assert.equal(checkInBody.safeParse(form({ clientTime: "1000" })).success, false, "epoch sebelum 2020 tidak masuk akal");
});

test("check-in multipart: selfie wajib berupa berkas, deviceId sesuai pola, kunci asing ditolak", () => {
  assert.equal(checkInBody.safeParse(form({ selfie: "bukan-berkas" })).success, false);
  assert.equal(checkInBody.safeParse(form({ selfie: undefined })).success, false);
  assert.equal(checkInBody.safeParse(form({ selfie: new File([], "kosong.jpg") })).success, false);
  assert.equal(checkInBody.safeParse(form({ deviceId: "pendek" })).success, false);
  assert.equal(checkInBody.safeParse(form({ deviceId: "ada spasi di sini" })).success, false);
  assert.equal(checkInBody.safeParse(form({ studentId: "siswa-lain" })).success, false);
});

test("precheck JSON: angka asli, accuracy/mocked boleh null, kunci asing ditolak", () => {
  const base = { latitude: -6.9, longitude: 107.6, locationTimestamp: 1790000000000, clientTime: 1790000001000 };
  assert.equal(precheckBody.safeParse(base).success, true);
  assert.equal(precheckBody.safeParse({ ...base, accuracy: null, mocked: null }).success, true);
  assert.equal(precheckBody.safeParse({ ...base, latitude: "-6.9" }).success, false);
  assert.equal(precheckBody.safeParse({ ...base, locationTimestamp: 1.5 }).success, false);
  assert.equal(precheckBody.safeParse({ ...base, deviceId: "device-test-0001" }).success, false);
});

test("query riwayat: format YYYY-MM", () => {
  assert.equal(historyQuery.safeParse({ month: "2026-09" }).success, true);
  assert.equal(historyQuery.safeParse({}).success, true);
  assert.equal(historyQuery.safeParse({ month: "2026-13" }).success, false);
  assert.equal(historyQuery.safeParse({ month: "2026-9" }).success, false);
});
