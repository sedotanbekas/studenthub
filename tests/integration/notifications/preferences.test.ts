/**
 * Kategori kabar sekolah per akun admin (N2): GET/PUT /me/notification-preferences, PUT
 * /school/admins/{id}/notification-preferences (admin utama untuk admin tambahan), penyaringan siaran admin saat
 * menulis (notifySchoolAdmins), cadangan admin utama, akun yang belum pernah masuk, notifikasi pribadi tidak disaring.
 */
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { GET as getMine, PUT as putMine } from "@/app/api/v1/me/notification-preferences/route";
import { PUT as putAdmin } from "@/app/api/v1/school/admins/[id]/notification-preferences/route";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { notifySchoolAdmins, notifyUsers } from "@/lib/notifications/notify";
import { withTx } from "@/lib/tx";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma, uniq } from "../helpers/db";
import { createSchool, createSchoolAdmin, createSponsor, createStudent, createSuperAdmin, type TestUser } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";

beforeEach(resetAllLimiters);
after(disconnect);

interface Prefs {
  mutedCategories: string[];
  mutableCategories: string[];
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
}

const token = async (userId: string) => (await createSessionToken(userId, { platform: "WEB", deviceId: null })).token;

/** Admin yang pernah masuk (bisa dijangkau); admin utama = primarySchoolId terisi. */
async function admin(schoolId: string, options: { primary?: boolean; reachable?: boolean } = {}): Promise<TestUser> {
  const user = await createSchoolAdmin(schoolId);
  return prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: options.reachable === false ? null : new Date(), ...(options.primary ? { primarySchoolId: schoolId } : {}) },
  });
}

async function schoolWithAdmins() {
  const school = await createSchool();
  const P = await admin(school.id, { primary: true });
  const A = await admin(school.id);
  const B = await admin(school.id);
  return { school, P, A, B };
}

const getPrefs = async (userId: string) => callRoute<Envelope<Prefs>>(getMine, { method: "GET", url: "/api/v1/me/notification-preferences", bearer: await token(userId) });
const putPrefs = async (userId: string, json: unknown) => callRoute<Envelope<Prefs>>(putMine, { method: "PUT", url: "/api/v1/me/notification-preferences", bearer: await token(userId), json });
const mute = (userId: string, categories: Array<"FINANCE" | "STUDENT_AFFAIRS">) => prisma.notificationMute.createMany({ data: categories.map((category) => ({ userId, category })) });

/** Satu siaran ber-judul unik; mengembalikan penerimanya (urut id). */
async function broadcast(schoolId: string, type: "PAYMENT_SUBMITTED" | "LEAVE_SUBMITTED" | "SCHOOL_SETTINGS_CHANGED"): Promise<string[]> {
  const title = uniq(`Uji ${type}`);
  await withTx((tx) => notifySchoolAdmins(tx, schoolId, { type, title, body: "Isi uji" }, { now: new Date() }));
  const rows = await prisma.notification.findMany({ where: { type, title, user: { schoolId } }, select: { userId: true } });
  return rows.map((r) => r.userId).sort();
}

test("GET tanpa baris: terima semua; PUT duplikat menyimpan satu baris + audit; PUT sama tanpa audit baru", async () => {
  const { school, A } = await schoolWithAdmins();
  const empty = await getPrefs(A.id);
  assert.equal(empty.status, 200, JSON.stringify(empty.body?.error));
  assert.deepEqual(empty.body?.data, { mutedCategories: [], mutableCategories: ["FINANCE", "STUDENT_AFFAIRS"], updatedAt: null, updatedBy: null });
  const saved = await putPrefs(A.id, { mutedCategories: ["FINANCE", "FINANCE"] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body?.error));
  assert.deepEqual([saved.body?.data.mutedCategories, saved.body?.data.updatedBy?.id], [["FINANCE"], A.id]);
  assert.equal(await prisma.notificationMute.count({ where: { userId: A.id } }), 1);
  const audits = await prisma.auditLog.findMany({ where: { action: "user.notification_mutes", entityId: A.id } });
  assert.deepEqual(audits.map((a) => [a.schoolId, a.before, a.after]), [[school.id, { mutedCategories: [] }, { mutedCategories: ["FINANCE"] }]]);
  await putPrefs(A.id, { mutedCategories: ["FINANCE"] });
  assert.equal(await prisma.auditLog.count({ where: { action: "user.notification_mutes", entityId: A.id } }), 1);
  const cleared = await putPrefs(A.id, { mutedCategories: [] });
  assert.deepEqual(cleared.body?.data.mutedCategories, []);
  assert.equal(await prisma.notificationMute.count({ where: { userId: A.id } }), 0);
});

test("validasi & peran: SYSTEM/tanpa kolom -> 400; siswa, sponsor, super admin -> 403", async () => {
  const { school, A } = await schoolWithAdmins();
  for (const body of [{ mutedCategories: ["SYSTEM"] }, {}, { mutedCategories: ["FINANCE"], extra: 1 }]) {
    assert.equal((await putPrefs(A.id, body)).status, 400, JSON.stringify(body));
  }
  const student = await createStudent(school.id);
  const sponsor = await createSponsor();
  const superAdmin = await createSuperAdmin();
  for (const userId of [student.user.id, sponsor.user.id, superAdmin.id]) assert.equal((await getPrefs(userId)).status, 403);
});

test("siaran admin disaring saat menulis: Keuangan / Kesiswaan / Sistem; notifikasi pribadi tidak disaring", async () => {
  const { school, P, A, B } = await schoolWithAdmins();
  await mute(A.id, ["FINANCE"]);
  await mute(B.id, ["STUDENT_AFFAIRS"]);
  assert.deepEqual(await broadcast(school.id, "PAYMENT_SUBMITTED"), [P.id, B.id].sort());
  assert.deepEqual(await broadcast(school.id, "LEAVE_SUBMITTED"), [P.id, A.id].sort());
  assert.deepEqual(await broadcast(school.id, "SCHOOL_SETTINGS_CHANGED"), [P.id, A.id, B.id].sort());
  await withTx((tx) => notifyUsers(tx, [A.id], { type: "INVOICE_ISSUED", title: "Pribadi", body: "Tagihan" }, { now: new Date() }));
  assert.equal(await prisma.notification.count({ where: { userId: A.id, type: "INVOICE_ISSUED" } }), 1);
});

test("cadangan: semua mematikan -> admin utama; admin utama nonaktif -> semua; penerima belum pernah masuk -> admin utama ikut", async () => {
  const { school, P, A, B } = await schoolWithAdmins();
  for (const id of [P.id, A.id, B.id]) await mute(id, ["FINANCE"]);
  assert.deepEqual(await broadcast(school.id, "PAYMENT_SUBMITTED"), [P.id]);
  await prisma.user.update({ where: { id: P.id }, data: { isActive: false } });
  assert.deepEqual(await broadcast(school.id, "PAYMENT_SUBMITTED"), [A.id, B.id].sort());

  const other = await createSchool();
  const P2 = await admin(other.id, { primary: true });
  const dormant = await admin(other.id, { reachable: false });
  await mute(P2.id, ["FINANCE"]);
  assert.deepEqual(await broadcast(other.id, "PAYMENT_SUBMITTED"), [P2.id, dormant.id].sort());
});

test("tidak berlaku mundur: notifikasi lama tetap belum dibaca; setelah dinyalakan lagi kabar berikutnya datang", async () => {
  const { school, A } = await schoolWithAdmins();
  await broadcast(school.id, "PAYMENT_SUBMITTED");
  await putPrefs(A.id, { mutedCategories: ["FINANCE"] });
  assert.equal(await prisma.notification.count({ where: { userId: A.id, type: "PAYMENT_SUBMITTED", readAt: null } }), 1);
  await broadcast(school.id, "PAYMENT_SUBMITTED");
  assert.equal(await prisma.notification.count({ where: { userId: A.id, type: "PAYMENT_SUBMITTED" } }), 1);
  await putPrefs(A.id, { mutedCategories: [] });
  await broadcast(school.id, "PAYMENT_SUBMITTED");
  assert.equal(await prisma.notification.count({ where: { userId: A.id, type: "PAYMENT_SUBMITTED" } }), 2);
});

test("PUT /school/admins/{id}/notification-preferences: admin utama untuk admin tambahan; dirinya sendiri lewat /me", async () => {
  const { school, P, A } = await schoolWithAdmins();
  const other = await schoolWithAdmins();
  const put = async (bearer: string, id: string, json: unknown, schoolId?: string) =>
    callRoute<Envelope<{ id: string; mutedCategories: string[] }>>(putAdmin, {
      method: "PUT", url: `/api/v1/school/admins/${id}/notification-preferences${schoolId ? `?schoolId=${schoolId}` : ""}`, bearer, json, params: { id },
    });
  const primaryToken = await token(P.id);
  const ok = await put(primaryToken, A.id, { mutedCategories: ["STUDENT_AFFAIRS"] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body?.error));
  assert.deepEqual(ok.body?.data.mutedCategories, ["STUDENT_AFFAIRS"]);
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.notification_mutes", entityId: A.id } });
  assert.equal(audit.actorId, P.id);
  const mine = await getPrefs(A.id);
  assert.deepEqual([mine.body?.data.mutedCategories, mine.body?.data.updatedBy], [["STUDENT_AFFAIRS"], { id: P.id, name: P.name }]);

  const self = await put(primaryToken, P.id, { mutedCategories: ["FINANCE"] });
  assert.deepEqual([self.status, self.body?.error?.code], [403, "PRIMARY_ADMIN_PROTECTED"]);
  const extra = await put(await token(A.id), A.id, { mutedCategories: [] });
  assert.deepEqual([extra.status, extra.body?.error?.code], [403, "PRIMARY_ADMIN_ONLY"]);
  assert.equal((await put(primaryToken, other.A.id, { mutedCategories: [] })).status, 404);
  const student = await createStudent(school.id);
  assert.equal((await put(primaryToken, student.user.id, { mutedCategories: [] })).status, 404);
  const superToken = await token((await createSuperAdmin()).id);
  assert.deepEqual([(await put(superToken, A.id, { mutedCategories: [] })).body?.error?.code], ["SCHOOL_ID_REQUIRED"]);
  assert.equal((await put(superToken, A.id, { mutedCategories: [] }, school.id)).status, 200);
});
