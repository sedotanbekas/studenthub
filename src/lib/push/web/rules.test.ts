import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { operations } from "@/lib/frontend/catalog";
import { sectionAllowed } from "@/lib/frontend/modules";
import {
  WEB_PUSH_INBOX_SCREENS,
  WEB_PUSH_SECTIONS,
  buildWebPushPayload,
  checkPushEndpoint,
  classifyWebPushError,
  endpointHashOf,
  isValidSubscriptionKeys,
  isVapidSubject,
  webPathOf,
  webPushSettingsOf,
  webPushTtlSeconds,
} from "./rules";
import { generateVapidKeys } from "./vapid-keys";

const KEYS = generateVapidKeys();
const env = (extra: Record<string, string | undefined> = {}) => ({ PUSH_TRANSPORT: "log", APP_ORIGIN: "https://studenthub.id", VAPID_PUBLIC_KEY: KEYS.publicKey, VAPID_PRIVATE_KEY: KEYS.privateKey, ...extra });

test("webPushSettingsOf: tanpa kunci / kunci rusak / memory / subjek", () => {
  assert.deepEqual(webPushSettingsOf(env({ VAPID_PUBLIC_KEY: undefined })), { mode: "off", reason: "NO_KEYS" });
  assert.deepEqual(webPushSettingsOf(env({ VAPID_PRIVATE_KEY: "" })), { mode: "off", reason: "NO_KEYS" });
  assert.deepEqual(webPushSettingsOf(env({ VAPID_PRIVATE_KEY: "pendek" })), { mode: "off", reason: "BAD_KEYS" });
  assert.equal(webPushSettingsOf(env({ PUSH_TRANSPORT: "memory", APP_ORIGIN: "http://127.0.0.1:3030" })).mode, "memory", "test & CI: tanpa cek subjek");
  assert.deepEqual(webPushSettingsOf(env({ APP_ORIGIN: "http://localhost:3030" })), { mode: "off", reason: "BAD_SUBJECT" });
  assert.deepEqual(webPushSettingsOf(env({ APP_ORIGIN: "https://localhost:3030" })), { mode: "off", reason: "BAD_SUBJECT" });
  const vapid = webPushSettingsOf(env());
  assert.equal(vapid.mode, "vapid");
  assert.equal(vapid.mode === "vapid" ? vapid.subject : null, "https://studenthub.id");
  const mail = webPushSettingsOf(env({ APP_ORIGIN: "http://localhost:3030", VAPID_SUBJECT: "mailto:ops@studenthub.id" }));
  assert.equal(mail.mode !== "off" && mail.subject, "mailto:ops@studenthub.id");
  assert.equal(isVapidSubject("https://staging.studenthub.id"), true);
  assert.equal(isVapidSubject("https://app.localhost"), false);
  assert.equal(isVapidSubject("mailto:bukan email"), false);
});

test("checkPushEndpoint: hanya https ke push service dikenal (penjaga SSRF)", () => {
  for (const ok of ["https://fcm.googleapis.com/fcm/send/abc:def", "https://web.push.apple.com/QJx", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://wns2-sg2p.notify.windows.com/w/?token=x"]) {
    assert.equal(checkPushEndpoint(ok), true, ok);
  }
  for (const bad of [
    "http://fcm.googleapis.com/fcm/send/x", "https://10.0.0.1/fcm", "https://[::1]/x", "https://evil.com/fcm.googleapis.com", "https://fcm.googleapis.com.evil.com/x",
    "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "https://push.apple.com/x", "bukan url", `https://fcm.googleapis.com/${"a".repeat(2030)}`,
  ]) {
    assert.equal(checkPushEndpoint(bad), false, bad);
  }
});

test("endpointHashOf: 64 heksa, deterministik", () => {
  const hash = endpointHashOf("https://fcm.googleapis.com/fcm/send/abc");
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, endpointHashOf("https://fcm.googleapis.com/fcm/send/abc"));
  assert.notEqual(hash, endpointHashOf("https://fcm.googleapis.com/fcm/send/abd"));
});

test("isValidSubscriptionKeys: titik P-256 sah + auth 16 byte", () => {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]).toString("base64url");
  const auth = Buffer.alloc(16, 9).toString("base64url");
  assert.equal(isValidSubscriptionKeys({ p256dh: point, auth }), true);
  const offCurve = Buffer.alloc(65, 1);
  offCurve[0] = 4;
  assert.equal(isValidSubscriptionKeys({ p256dh: offCurve.toString("base64url"), auth }), false, "65 byte tetapi bukan titik kurva");
  assert.equal(isValidSubscriptionKeys({ p256dh: point, auth: Buffer.alloc(12).toString("base64url") }), false);
  assert.equal(isValidSubscriptionKeys({ p256dh: "a+b", auth }), false);
});

test("webPathOf: tabel per peran, absen langsung, cadangan kotak masuk, id di-encode", () => {
  assert.equal(webPathOf("STUDENT", "invoice", "n1"), "/hub/my-billing?notif=n1");
  assert.equal(webPathOf("STUDENT", "attendance-alpha", "n1"), "/hub/my-leave?notif=n1");
  assert.equal(webPathOf("STUDENT", "check-in", "n1"), "/hub/my-attendance?absen=1&notif=n1");
  assert.equal(webPathOf("SCHOOL_ADMIN", "leave-request", "n1"), "/hub/attendance?notif=n1");
  assert.equal(webPathOf("SCHOOL_ADMIN", "attendance-day", "n1"), "/hub/attendance?notif=n1");
  assert.equal(webPathOf("SCHOOL_ADMIN", "payment-review", "n1"), "/hub/billing?notif=n1");
  assert.equal(webPathOf("SUPER_ADMIN", "topup-review", "n1"), "/hub/topups?notif=n1");
  assert.equal(webPathOf("SPONSOR", "ad", "n1"), "/hub/campaigns?notif=n1");
  assert.equal(webPathOf("SPONSOR", "payment-review", "n1"), "/hub/notifications?notif=n1", "layar milik peran lain");
  assert.equal(webPathOf("STUDENT", "announcement", "a b&c"), "/hub/notifications?notif=a%20b%26c");
});

test("setiap bagian tujuan boleh dibuka peran penerimanya", () => {
  for (const [role, sections] of Object.entries(WEB_PUSH_SECTIONS)) {
    for (const section of Object.values(sections)) assert.ok(sectionAllowed(role as keyof typeof WEB_PUSH_SECTIONS, section), `${role} -> ${section}`);
  }
});

/** Pindai layar yang benar-benar dipakai template: tiap layar dipetakan untuk suatu peran atau sengaja ke kotak masuk. */
test("setiap layar notifikasi di template punya tujuan push", () => {
  const root = join(process.cwd(), "src/lib");
  const files = [...readdirSync(join(root, "notifications/templates")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => join(root, "notifications/templates", f)), join(root, "students/nisn-release-notice.ts")];
  const screens = new Set(files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/(?:screen: |SCREEN = )"([a-z-]+)"/g)].map((m) => m[1]!)));
  assert.ok(screens.size >= 15, `layar ditemukan: ${[...screens].join(",")}`);
  const mapped = new Set([...Object.values(WEB_PUSH_SECTIONS).flatMap((m) => Object.keys(m)), ...WEB_PUSH_INBOX_SCREENS]);
  for (const screen of screens) assert.ok(mapped.has(screen), `layar "${screen}" belum punya tujuan push`);
});

test("webPushTtlSeconds: sisa jendela 60 menit, dibatasi expiresAt, minimal 60 detik", () => {
  const created = new Date("2026-10-03T00:00:00Z");
  const at = (min: number) => new Date(created.getTime() + min * 60_000);
  assert.equal(webPushTtlSeconds(created, at(0)), 3600);
  assert.equal(webPushTtlSeconds(created, at(59)), 60);
  assert.equal(webPushTtlSeconds(created, at(61)), 60);
  assert.equal(webPushTtlSeconds(created, at(10), at(15)), 300, "pengingat kedaluwarsa saat bel");
  assert.equal(webPushTtlSeconds(created, at(10), at(9)), 60);
});

test("buildWebPushPayload: potong judul/isi tanpa memecah emoji, tag & tautan", () => {
  const payload = buildWebPushPayload({ id: "n9", title: "\u{1F600}".repeat(120), body: "kata ".repeat(100), data: { screen: "invoice", id: "inv1" } }, "STUDENT", 4);
  assert.ok(Array.from(payload.title).length <= 100);
  assert.ok(Array.from(payload.body).length <= 178);
  assert.equal(payload.title.includes("�"), false);
  assert.deepEqual([payload.url, payload.tag, payload.badge, payload.notificationId], ["/hub/my-billing?notif=n9", "n-n9", 4, "n9"]);
  assert.equal(buildWebPushPayload({ id: "n1", title: "t", body: "b", data: null }, "SPONSOR", null).url, "/hub/notifications?notif=n1");
});

test("classifyWebPushError: 404/410 mati, 429/5xx ulang, 4xx gagal, jaringan ulang, lainnya gagal", () => {
  assert.deepEqual(classifyWebPushError({ statusCode: 410 }), { kind: "unregistered" });
  assert.deepEqual(classifyWebPushError({ statusCode: 404 }), { kind: "unregistered" });
  assert.equal(classifyWebPushError({ statusCode: 429 }).kind, "retry");
  assert.equal(classifyWebPushError({ statusCode: 503 }).kind, "retry");
  assert.deepEqual(classifyWebPushError({ statusCode: 400 }), { kind: "fail", error: "HTTP_400" });
  assert.deepEqual(classifyWebPushError({ statusCode: 403 }), { kind: "fail", error: "HTTP_403" });
  assert.deepEqual(classifyWebPushError({ statusCode: 413 }), { kind: "fail", error: "HTTP_413" });
  assert.equal(classifyWebPushError(Object.assign(new Error("reset"), { code: "ECONNRESET" })).kind, "retry");
  assert.equal(classifyWebPushError(Object.assign(new Error("habis"), { code: "WEB_PUSH_TIMEOUT" })).kind, "retry");
  assert.deepEqual(classifyWebPushError(new TypeError("enkripsi gagal")), { kind: "fail", error: "WEB_PUSH_REJECTED" });
});

test("katalog web memuat ketiga operasi Web Push (proxy /api/web hanya meneruskan operasi katalog)", () => {
  const ids = new Set(operations.map((op) => op.id));
  for (const id of ["getMyWebPushStatus", "upsertMyWebPushSubscription", "removeMyWebPushSubscription"]) assert.ok(ids.has(id), id);
});
