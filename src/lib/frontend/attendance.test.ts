import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_ACCURACY_M,
  FIX_KEEP_MS,
  accuracyAdvice,
  cameraErrorMessage,
  preferFix,
  simulateDemoFix,
  cameraHint,
  canShoot,
  faceCheckOf,
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

test("todayHeadline mode uji: hari libur / di luar jam tetap mengajak absen dan menjelaskan pelonggarannya", () => {
  const holiday = { ...baseToday, testMode: true, schoolDay: { isSchoolDay: false, reason: "HOLIDAY", holidayName: "Maulid Nabi" }, window: { ...baseToday.window, state: "CLOSED" } };
  assert.deepEqual(todayHeadline(holiday), { tone: "action", title: "Kamu belum absen", note: "Mode uji aktif: absen bisa dari mana saja dan kapan saja. Akurasi GPS dan foto wajah tetap wajib." });
  const done = { ...holiday, canCheckIn: false, blockReason: "ALREADY_CHECKED_IN", record: { status: "HADIR", checkInTimeLocal: "19:02", lateMinutes: null } };
  assert.equal(todayHeadline(done).title, "Sudah absen pukul 19:02");
});

test("todayHeadline membedakan alasan bukan hari sekolah: semester belum diatur vs hari libur mingguan", () => {
  const outsideTerm = { ...baseToday, canCheckIn: false, blockReason: "NOT_SCHOOL_DAY", schoolDay: { isSchoolDay: false, reason: "OUTSIDE_TERM", holidayName: null } };
  assert.deepEqual(todayHeadline(outsideTerm), {
    tone: "neutral",
    title: "Absensi belum tersedia",
    note: "Hari ini di luar masa semester. Bila seharusnya hari sekolah, hubungi admin sekolah.",
  });
  const dayOff = { ...outsideTerm, schoolDay: { isSchoolDay: false, reason: "DAY_OFF", holidayName: null } };
  assert.deepEqual(todayHeadline(dayOff), { tone: "neutral", title: "Hari ini bukan hari sekolah", note: "Tidak ada absensi hari ini." });
});

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const sample = (accuracy: number, timestamp: number) => ({ accuracy, timestamp });

test("preferFix: fix lebih akurat menang; fix akurat yang sudah lama digantikan fix terbaru", () => {
  assert.deepEqual(preferFix(null, sample(40, 1000)), sample(40, 1000));
  assert.deepEqual(preferFix(sample(40, 1000), sample(12, 2000)), sample(12, 2000));
  assert.deepEqual(preferFix(sample(12, 1000), sample(40, 3000)), sample(12, 1000), "fix akurat 2 detik lalu tetap dipakai");
  assert.deepEqual(preferFix(sample(12, 1000), sample(40, 1000 + FIX_KEEP_MS + 1)), sample(40, 1000 + FIX_KEEP_MS + 1), "fix lama tidak dipertahankan");
});

test("accuracyAdvice: baik, lemah, atau masih perkiraan jaringan dengan langkah per perangkat", () => {
  assert.deepEqual(accuracyAdvice(18, 100, ANDROID), { level: "good", message: "" });
  const weak = accuracyAdvice(240, 100, ANDROID);
  assert.equal(weak.level, "weak");
  assert.match(weak.message, /±240 m/);
  assert.match(weak.message, /area terbuka/);
  const android = accuracyAdvice(100000, 100, ANDROID);
  assert.equal(android.level, "coarse");
  assert.match(android.message, /±100 km/);
  assert.match(android.message, /Akurasi Lokasi Google/);
  assert.match(accuracyAdvice(3500, 100, IPHONE).message, /Lokasi Akurat/);
  assert.match(accuracyAdvice(3500, 100, IPHONE).message, /±3,5 km/);
  assert.match(accuracyAdvice(100000, 100, DESKTOP).message, /tidak memiliki GPS/);
});

test("simulateDemoFix: mode demo memakai posisi asli dengan akurasi disimulasikan", () => {
  assert.deepEqual(simulateDemoFix({ latitude: -6.2, longitude: 106.8, accuracy: 100000 }), { latitude: -6.2, longitude: 106.8, accuracy: DEMO_ACCURACY_M });
  assert.deepEqual(simulateDemoFix({ latitude: -6.2, longitude: 106.8, accuracy: 5 }), { latitude: -6.2, longitude: 106.8, accuracy: 5 });
});

test("simulateDemoFix membaca koordinat browser asli (getter di prototype, bukan properti sendiri)", () => {
  const coords = Object.create({ get latitude() { return -6.2; }, get longitude() { return 106.8; }, get accuracy() { return 100000; } }) as { latitude: number; longitude: number; accuracy: number };
  assert.deepEqual(Object.keys(coords), [], "seperti GeolocationCoordinates");
  assert.deepEqual(simulateDemoFix(coords), { latitude: -6.2, longitude: 106.8, accuracy: DEMO_ACCURACY_M });
});

test("faceCheckOf: hasil deteksi wajah saat foto diambil (dasar flag tinjauan admin)", () => {
  assert.equal(faceCheckOf("ready", true), "DETECTED");
  assert.equal(faceCheckOf("ready", false), "NOT_DETECTED");
  assert.equal(faceCheckOf("loading", false), "UNAVAILABLE");
  assert.equal(faceCheckOf("failed", false), "UNAVAILABLE");
});

test("canShoot: deteksi wajah opsional — cukup video sudah tampil dan tidak sedang memotret", () => {
  assert.equal(canShoot({ videoReady: true, busy: false }), true);
  assert.equal(canShoot({ videoReady: false, busy: false }), false);
  assert.equal(canShoot({ videoReady: true, busy: true }), false);
});

test("cameraHint: wajah belum/tidak terdeteksi tetap boleh memotret, dengan catatan diperiksa admin", () => {
  const ok = { ok: true, message: "Wajah terdeteksi. Tahan posisi lalu ambil foto." };
  const notYet = { ok: false, message: "Dekatkan wajah ke kamera." };
  assert.equal(cameraHint("ready", ok, true), ok.message);
  assert.equal(cameraHint("ready", notYet, false), "Dekatkan wajah ke kamera. Foto tetap bisa diambil; admin sekolah akan memeriksanya.");
  assert.match(cameraHint("loading", notYet, false), /^Menyiapkan pendeteksi wajah… Foto tetap bisa diambil/);
  assert.match(cameraHint("failed", notYet, false), /^Pendeteksi wajah tidak tersedia. Foto tetap bisa diambil/);
});

test("demoWouldBeLate: setelah batas tepat waktu (jam lokal sekolah) -> terlambat", async () => {
  const { demoWouldBeLate } = await import("./attendance");
  const today = { timezone: "WIB", window: { lateAfter: "07:15" } };
  assert.equal(demoWouldBeLate(today, new Date("2026-09-25T00:15:00.000Z")), false, "07:15 WIB masih tepat waktu");
  assert.equal(demoWouldBeLate(today, new Date("2026-09-25T00:16:00.000Z")), true);
  assert.equal(demoWouldBeLate({ timezone: "WIT", window: { lateAfter: "07:15" } }, new Date("2026-09-25T00:16:00.000Z")), true, "09:16 WIT");
});
