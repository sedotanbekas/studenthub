import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_MUTABLE_CATEGORIES,
  CATEGORY_BY_TYPE,
  SCHOOL_ADMIN_BROADCAST_TYPES,
  diffMutedCategories,
  initialPushStatus,
  isReachableAdmin,
  normalizeMutedCategories,
  previewText,
  resolveCategory,
  selectBroadcastRecipients,
  type BroadcastCandidate,
} from "./rules";

test("resolveCategory memakai peta tipe atau kategori eksplisit untuk pengumuman", () => {
  assert.equal(resolveCategory("PAYMENT_APPROVED"), "FINANCE");
  assert.equal(resolveCategory("ANNOUNCEMENT", "EVENT"), "EVENT");
  assert.throws(() => resolveCategory("ANNOUNCEMENT"));
});

test("push hanya untuk siswa", () => {
  assert.equal(initialPushStatus("STUDENT"), "PENDING");
  assert.equal(initialPushStatus("SCHOOL_ADMIN"), "SKIPPED");
});

test("previewText merapikan spasi dan memotong di batas kata", () => {
  assert.equal(previewText("  halo\n\n dunia  "), "halo dunia");
  const long = "kata ".repeat(200);
  const out = previewText(long, 50);
  assert.ok(Array.from(out).length <= 50);
  assert.ok(out.endsWith("…"));
  const emoji = "\u{1F600}".repeat(60);
  assert.equal(Array.from(previewText(emoji, 10)).length, 10);
});

// ----------------------------------------------------------------------------- mute kategori admin (N2)

const admin = (userId: string, muted: BroadcastCandidate["muted"] = [], extra: Partial<BroadcastCandidate> = {}): BroadcastCandidate => ({
  userId, isPrimary: false, reachable: true, muted, ...extra,
});
const P = admin("P", [], { isPrimary: true });

test("kategori yang bisa dimatikan = kategori siaran admin sekolah selain SYSTEM (dijaga)", () => {
  const broadcast = new Set(SCHOOL_ADMIN_BROADCAST_TYPES.map((type) => CATEGORY_BY_TYPE[type]));
  broadcast.delete("SYSTEM");
  assert.deepEqual([...broadcast].sort(), [...ADMIN_MUTABLE_CATEGORIES].sort());
  assert.equal((ADMIN_MUTABLE_CATEGORIES as readonly string[]).includes("SYSTEM"), false);
});

test("selectBroadcastRecipients: SYSTEM ke semua; mute membuang penerima; urutan dijaga", () => {
  const candidates = [P, admin("A", ["FINANCE"]), admin("B", ["STUDENT_AFFAIRS"]), admin("C", ["SYSTEM"])];
  assert.deepEqual(selectBroadcastRecipients(candidates, "SYSTEM"), ["P", "A", "B", "C"]);
  assert.deepEqual(selectBroadcastRecipients(candidates, "FINANCE"), ["P", "B", "C"]);
  assert.deepEqual(selectBroadcastRecipients(candidates, "STUDENT_AFFAIRS"), ["P", "A", "C"]);
  assert.deepEqual(selectBroadcastRecipients([], "FINANCE"), []);
});

test("selectBroadcastRecipients: semua mematikan -> admin utama; tanpa admin utama -> semua", () => {
  assert.deepEqual(selectBroadcastRecipients([admin("A", ["FINANCE"]), { ...P, muted: ["FINANCE"] }, admin("B", ["FINANCE"])], "FINANCE"), ["P"]);
  assert.deepEqual(selectBroadcastRecipients([admin("A", ["FINANCE"]), admin("B", ["FINANCE"])], "FINANCE"), ["A", "B"]);
});

test("selectBroadcastRecipients: penerima tersisa yang belum pernah masuk tidak dihitung -> admin utama ikut menerima", () => {
  const dormant = admin("B", [], { reachable: false });
  assert.deepEqual(selectBroadcastRecipients([{ ...P, muted: ["FINANCE"] }, dormant], "FINANCE"), ["P", "B"]);
  assert.deepEqual(selectBroadcastRecipients([{ ...P, muted: ["FINANCE"] }, dormant, admin("C")], "FINANCE"), ["B", "C"]);
  assert.deepEqual(selectBroadcastRecipients([admin("A", ["FINANCE"]), dormant], "FINANCE"), ["A", "B"], "tanpa admin utama: semua");
});

test("isReachableAdmin: pernah masuk dan kata sandi sementara belum kedaluwarsa", () => {
  const now = new Date("2026-10-03T00:00:00Z");
  assert.equal(isReachableAdmin({ lastLoginAt: null, mustChangePassword: false, tempPasswordExpiresAt: null }, now), false);
  assert.equal(isReachableAdmin({ lastLoginAt: now, mustChangePassword: false, tempPasswordExpiresAt: null }, now), true);
  assert.equal(isReachableAdmin({ lastLoginAt: now, mustChangePassword: true, tempPasswordExpiresAt: new Date("2026-10-02T00:00:00Z") }, now), false);
  assert.equal(isReachableAdmin({ lastLoginAt: now, mustChangePassword: true, tempPasswordExpiresAt: new Date("2026-10-04T00:00:00Z") }, now), true);
});

test("normalizeMutedCategories & diffMutedCategories", () => {
  assert.deepEqual(normalizeMutedCategories(["STUDENT_AFFAIRS", "FINANCE", "FINANCE", "SYSTEM", "ACADEMIC"]), ["FINANCE", "STUDENT_AFFAIRS"]);
  assert.deepEqual(diffMutedCategories(["FINANCE"], ["FINANCE"]), { added: [], removed: [] });
  assert.deepEqual(diffMutedCategories(["SYSTEM"], []), { added: [], removed: ["SYSTEM"] });
  assert.deepEqual(diffMutedCategories(["FINANCE"], ["STUDENT_AFFAIRS"]), { added: ["STUDENT_AFFAIRS"], removed: ["FINANCE"] });
});
