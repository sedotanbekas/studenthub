import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cameraErrorMessage,
  faceVerdict,
  fixAgeOk,
  geolocationErrorMessage,
  loginDeviceId,
  schoolClock,
  todayHeadline,
  webDeviceId,
  type FaceBox,
  type TodayView,
} from "./attendance";

const ANDROID = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36";
const FRAME = { width: 640, height: 480 };
const face = (over: Partial<FaceBox> = {}): FaceBox => ({ score: 0.92, x: 220, y: 130, width: 200, height: 220, ...over });

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

test("faceVerdict: tepat satu wajah jelas, cukup dekat, dan di tengah -> ok", () => {
  assert.deepEqual(faceVerdict([face()], FRAME), { ok: true, message: "Wajah terdeteksi. Tahan posisi lalu ambil foto." });
});

test("faceVerdict: tanpa wajah, banyak wajah, terlalu jauh, dan di pinggir ditolak dengan pesan jelas", () => {
  assert.equal(faceVerdict([], FRAME).message, "Wajah belum terlihat. Hadapkan wajah ke kamera dengan cahaya cukup.");
  assert.equal(faceVerdict([face(), face({ x: 20 })], FRAME).message, "Terdeteksi lebih dari satu wajah. Pastikan hanya kamu yang terlihat.");
  assert.equal(faceVerdict([face({ width: 80, height: 90 })], FRAME).message, "Dekatkan wajah ke kamera.");
  assert.equal(faceVerdict([face({ x: 0, width: 180 })], FRAME).message, "Posisikan wajah di tengah bingkai.");
  assert.equal(faceVerdict([face({ score: 0.3 })], FRAME).ok, false);
});

test("pesan izin lokasi & kamera memberi langkah yang bisa dilakukan siswa", () => {
  assert.match(geolocationErrorMessage(1), /Izin lokasi ditolak/);
  assert.match(geolocationErrorMessage(2), /Nyalakan GPS/);
  assert.match(geolocationErrorMessage(3), /terlalu lama/);
  assert.match(cameraErrorMessage("NotAllowedError"), /Izin kamera ditolak/);
  assert.match(cameraErrorMessage("NotFoundError"), /Kamera depan tidak ditemukan/);
  assert.match(cameraErrorMessage("NotReadableError"), /sedang dipakai aplikasi lain/);
  assert.match(cameraErrorMessage("Aneh"), /Kamera belum dapat dibuka/);
});

test("webDeviceId dibuat sekali (pola deviceId server) lalu dipakai ulang", () => {
  const storage = memoryStorage();
  const first = webDeviceId(storage, () => "0f8fad5b-d9cb-469f-a165-70867728950e");
  assert.equal(first, "web-0f8fad5b-d9cb-469f-a165-70867728950e");
  assert.match(first, /^[A-Za-z0-9._:-]{8,100}$/);
  assert.equal(webDeviceId(storage, () => "lain"), first);
  const legacy = memoryStorage({ studenthub_device: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" });
  assert.equal(webDeviceId(legacy, () => "x"), "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
});

test("loginDeviceId hanya untuk NISN dari browser HP", () => {
  const storage = memoryStorage();
  assert.match(loginDeviceId("0012345678", ANDROID, storage, () => "id-1234-5678") ?? "", /^web-/);
  assert.equal(loginDeviceId("0012345678", DESKTOP, storage, () => "id"), undefined);
  assert.equal(loginDeviceId("admin@sekolah.sch.id", ANDROID, storage, () => "id"), undefined);
});

test("fixAgeOk: fix lokasi maksimal 150 detik (di bawah batas server 180 detik)", () => {
  assert.equal(fixAgeOk(1_000_000, 1_000_000 + 150_000), true);
  assert.equal(fixAgeOk(1_000_000, 1_000_000 + 151_000), false);
});

test("schoolClock memakai zona sekolah, bukan zona perangkat", () => {
  const instant = new Date("2026-09-25T00:47:59Z");
  assert.deepEqual(schoolClock(instant, "WIB"), { hours: "07", minutes: "47", seconds: "59", zoneLabel: "Waktu Indonesia Barat", date: "Jum, 25 Sep 2026" });
  assert.equal(schoolClock(instant, "WITA").hours, "08");
  assert.equal(schoolClock(instant, "WIT").zoneLabel, "Waktu Indonesia Timur");
});

const baseToday: TodayView = {
  schoolDay: { isSchoolDay: true, reason: "SCHOOL_DAY", holidayName: null },
  window: { opensAt: "06:00", lateAfter: "07:15", closesAt: "10:00", state: "OPEN" },
  record: null,
  canCheckIn: true,
  blockReason: null,
};

test("todayHeadline merangkum status absen hari ini dengan nada tindakan", () => {
  assert.deepEqual(todayHeadline(baseToday), { tone: "action", title: "Kamu belum absen", note: "Absen dibuka 06:00–10:00. Tepat waktu sampai 07:15." });
  const done = { ...baseToday, canCheckIn: false, blockReason: "ALREADY_CHECKED_IN", record: { status: "TERLAMBAT", checkInTimeLocal: "07:31", lateMinutes: 31 } };
  assert.deepEqual(todayHeadline(done), { tone: "warning", title: "Sudah absen pukul 07:31", note: "Tercatat terlambat 31 menit." });
  const ontime = { ...done, record: { status: "HADIR", checkInTimeLocal: "06:45", lateMinutes: null } };
  assert.deepEqual(todayHeadline(ontime), { tone: "success", title: "Sudah absen pukul 06:45", note: "Tercatat hadir tepat waktu." });
  const holiday = { ...baseToday, canCheckIn: false, blockReason: "NOT_SCHOOL_DAY", schoolDay: { isSchoolDay: false, reason: "HOLIDAY", holidayName: "Maulid Nabi" } };
  assert.deepEqual(todayHeadline(holiday), { tone: "neutral", title: "Libur: Maulid Nabi", note: "Tidak ada absensi hari ini." });
  const closed = { ...baseToday, canCheckIn: false, blockReason: "CHECKIN_CLOSED", window: { ...baseToday.window, state: "CLOSED" } };
  assert.equal(todayHeadline(closed).title, "Absensi sudah ditutup");
  const early = { ...baseToday, canCheckIn: false, blockReason: "CHECKIN_NOT_OPEN", window: { ...baseToday.window, state: "BEFORE_OPEN" } };
  assert.equal(todayHeadline(early).note, "Absen dibuka pukul 06:00.");
});
