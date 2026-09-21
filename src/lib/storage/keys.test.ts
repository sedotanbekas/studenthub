import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { isAppError } from "@/lib/http/errors";
import {
  buildStorageKey, parseStorageKey, publicKeyFor, publicUrlFor, resolveInsideRoot,
} from "./keys";

const ID = Buffer.alloc(16, 0xab).toString("base64url");
const SELFIE_KEY = `private/attendance-selfie/2026/09/${ID}.jpg`;
const BANNER_PRIVATE = `private/ad-banner/2026/09/${ID}.webp`;
const BANNER_PUBLIC = `public/ad-banner/2026/09/${ID}.webp`;

function assertInvalidKey(fn: () => unknown): void {
  assert.throws(fn, (err: unknown) => isAppError(err) && err.status === 400 && err.code === "INVALID_STORAGE_KEY");
}

test("buildStorageKey: format bucket/kind-kebab/yyyy/mm/rand22.ext dan lolos parse", () => {
  const key = buildStorageKey("ATTENDANCE_SELFIE", "jpg", new Date("2026-09-21T03:00:00Z"), "private", () => Buffer.alloc(16, 0xab));
  assert.equal(key, SELFIE_KEY);
  assert.equal(ID.length, 22);
  const parsed = parseStorageKey(key);
  assert.deepEqual(parsed, { bucket: "private", kind: "ATTENDANCE_SELFIE", year: 2026, month: 9, id: ID, ext: "jpg" });
});

test("buildStorageKey: bulan memakai UTC dan acak default menghasilkan kunci unik", () => {
  const a = buildStorageKey("PAYMENT_PROOF", "jpg", new Date("2026-12-31T20:00:00Z"), "private");
  const b = buildStorageKey("PAYMENT_PROOF", "jpg", new Date("2026-12-31T20:00:00Z"), "private");
  assert.match(a, /^private\/payment-proof\/2026\/12\/[A-Za-z0-9_-]{22}\.jpg$/);
  assert.notEqual(a, b);
  assert.match(buildStorageKey("TOPUP_PROOF", "jpg", new Date("2027-01-05T00:00:00Z"), "private"), /^private\/topup-proof\/2027\/01\//);
  assert.match(buildStorageKey("LEAVE_ATTACHMENT", "jpg", new Date("2027-01-05T00:00:00Z"), "private"), /^private\/leave-attachment\//);
});

test("buildStorageKey: bucket publik hanya untuk AD_BANNER; acak cacat ditolak", () => {
  assert.match(buildStorageKey("AD_BANNER", "webp", new Date("2026-09-21T00:00:00Z"), "public"), /^public\/ad-banner\/2026\/09\//);
  assert.throws(() => buildStorageKey("ATTENDANCE_SELFIE", "jpg", new Date(), "public"));
  assert.throws(() => buildStorageKey("AD_BANNER", "webp", new Date(), "private", () => Buffer.alloc(8, 1)));
});

test("parseStorageKey: menerima kunci sah semua jenis", () => {
  assert.equal(parseStorageKey(BANNER_PRIVATE).kind, "AD_BANNER");
  assert.equal(parseStorageKey(BANNER_PUBLIC).bucket, "public");
  assert.equal(parseStorageKey(`private/topup-proof/2026/01/${ID}.jpg`).month, 1);
});

test("parseStorageKey: matriks penolakan (traversal, absolut, backslash, NUL, bentuk salah)", () => {
  const bad = [
    "",
    `../${SELFIE_KEY}`,
    `private/../private/attendance-selfie/2026/09/${ID}.jpg`,
    `private/attendance-selfie/2026/09/../${ID}.jpg`,
    `private\\attendance-selfie\\2026\\09\\${ID}.jpg`,
    `private/attendance-selfie/2026/09/..\\${ID}.jpg`,
    `/${SELFIE_KEY}`,
    `C:\\${SELFIE_KEY}`,
    `C:/${SELFIE_KEY}`,
    `\\\\server\\share\\${SELFIE_KEY}`,
    `${SELFIE_KEY}\0`,
    `private/attendance-selfie/2026/09/${ID.slice(0, 21)}\0.jpg`,
    `${SELFIE_KEY}\n`,
    ` ${SELFIE_KEY}`,
    SELFIE_KEY.toUpperCase(),
    `PRIVATE/attendance-selfie/2026/09/${ID}.jpg`,
    `shared/attendance-selfie/2026/09/${ID}.jpg`,
    `private/avatar/2026/09/${ID}.jpg`,
    `private/attendance-selfie/2026/09/${ID}.JPG`,
    `private/attendance-selfie/2026/09/${ID}.pdf`,
    `private/attendance-selfie/2026/09/${ID}.jpg.html`,
    `private/attendance-selfie/2026/13/${ID}.jpg`,
    `private/attendance-selfie/2026/00/${ID}.jpg`,
    `private/attendance-selfie/26/09/${ID}.jpg`,
    `private/attendance-selfie/2026/09/${ID.slice(0, 21)}.jpg`,
    `private/attendance-selfie/2026/09/${ID}x.jpg`,
    `private/attendance-selfie/2026/09/${ID.slice(0, 21)}..jpg`,
    `public/attendance-selfie/2026/09/${ID}.jpg`,
    `public/payment-proof/2026/09/${ID}.jpg`,
    `private//attendance-selfie/2026/09/${ID}.jpg`,
  ];
  for (const key of bad) assertInvalidKey(() => parseStorageKey(key));
});

test("resolveInsideRoot POSIX: tetap di dalam root", () => {
  assert.equal(resolveInsideRoot("/srv/storage", SELFIE_KEY, path.posix), `/srv/storage/private/attendance-selfie/2026/09/${ID}.jpg`);
  assert.equal(resolveInsideRoot("/srv/storage/", SELFIE_KEY, path.posix), `/srv/storage/private/attendance-selfie/2026/09/${ID}.jpg`);
  assert.equal(resolveInsideRoot("/", SELFIE_KEY, path.posix), `/private/attendance-selfie/2026/09/${ID}.jpg`);
});

test("resolveInsideRoot win32: tetap di dalam root", () => {
  assert.equal(resolveInsideRoot("D:\\storage", SELFIE_KEY, path.win32), `D:\\storage\\private\\attendance-selfie\\2026\\09\\${ID}.jpg`);
  assert.equal(resolveInsideRoot("D:\\", BANNER_PUBLIC, path.win32), `D:\\public\\ad-banner\\2026\\09\\${ID}.webp`);
});

test("resolveInsideRoot: root relatif diselesaikan terhadap cwd platform ini", () => {
  const out = resolveInsideRoot(".storage", SELFIE_KEY);
  assert.equal(out, path.resolve(".storage", "private", "attendance-selfie", "2026", "09", `${ID}.jpg`));
  assert.ok(path.isAbsolute(out));
});

test("resolveInsideRoot: matriks traversal ditolak di POSIX dan win32", () => {
  const bad = [
    "../etc/passwd",
    `private/../../${ID}.jpg`,
    "/etc/passwd",
    "C:\\Windows\\win.ini",
    `private\\..\\..\\${ID}.jpg`,
    `${SELFIE_KEY}\0.png`,
    "private/attendance-selfie/2026/09/..",
  ];
  for (const impl of [path.posix, path.win32]) {
    const root = impl === path.posix ? "/srv/storage" : "D:\\storage";
    for (const key of bad) assertInvalidKey(() => resolveInsideRoot(root, key, impl));
  }
});

test("publicKeyFor: private/ad-banner → public/ad-banner dengan sisa kunci sama", () => {
  assert.equal(publicKeyFor(BANNER_PRIVATE), BANNER_PUBLIC);
  assertInvalidKey(() => publicKeyFor(SELFIE_KEY));
  assertInvalidKey(() => publicKeyFor(BANNER_PUBLIC));
  assertInvalidKey(() => publicKeyFor("private/ad-banner/../x.webp"));
});

test("publicUrlFor: buang awalan public/ dan garis miring ganda", () => {
  assert.equal(publicUrlFor(BANNER_PUBLIC, "https://studenthub.medialab.co.id/media"), `https://studenthub.medialab.co.id/media/ad-banner/2026/09/${ID}.webp`);
  assert.equal(publicUrlFor(BANNER_PUBLIC, "https://cdn.example/media///"), `https://cdn.example/media/ad-banner/2026/09/${ID}.webp`);
  assertInvalidKey(() => publicUrlFor(BANNER_PRIVATE, "https://cdn.example/media"));
  assertInvalidKey(() => publicUrlFor(SELFIE_KEY, "https://cdn.example/media"));
});
