import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/school/holidays/route";
import { DELETE as deleteRoute, PATCH as patchRoute } from "@/app/api/v1/school/holidays/[id]/route";
import { holidaysLockKey } from "@/lib/lock-keys";
import { addDays, localParts, toDbDate } from "@/lib/time/zone";
import { disconnect, prisma, uniq } from "../helpers/db";
import { callRoute, type Envelope } from "../helpers/request";
import { createTenant, findAudit, holdLock, raceWhileHeld, setupTenants, withSchool, type TwoTenants } from "../academics/helpers";

interface Holiday {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  dayCount: number;
  scope: "SCHOOL" | "NATIONAL";
}

const BASE = "/api/v1/school/holidays";
/** Hari ini lokal WIB (sekolah factory ber-zona WIB). */
const today = localParts(new Date(), "WIB").ymd;
const nationalIds: string[] = [];

let env: TwoTenants;
before(async () => {
  env = await setupTenants();
});
after(async () => {
  await prisma.holiday.deleteMany({ where: { id: { in: nationalIds } } });
  await disconnect();
});

const list = (token: string, query = "") => callRoute<Envelope<Holiday[]>>(listRoute, { method: "GET", url: `${BASE}${query}`, bearer: token });
const post = (body: unknown, token: string, schoolId?: string) =>
  callRoute<Envelope<Holiday>>(createRoute, { method: "POST", url: withSchool(BASE, schoolId), bearer: token, json: body });
const patch = (id: string, body: unknown, token: string, schoolId?: string) =>
  callRoute<Envelope<Holiday>>(patchRoute, { method: "PATCH", url: withSchool(`${BASE}/${id}`, schoolId), bearer: token, json: body, params: { id } });
const remove = (id: string, token: string, schoolId?: string) =>
  callRoute<Envelope<{ id: string }>>(deleteRoute, { method: "DELETE", url: withSchool(`${BASE}/${id}`, schoolId), bearer: token, params: { id } });

const holiday = (offsetStart: number, offsetEnd = offsetStart, name = uniq("Libur")) => ({
  name,
  startDate: addDays(today, offsetStart),
  endDate: addDays(today, offsetEnd),
});

test("admin sekolah menambah libur -> 201 scope SCHOOL, dayCount inklusif, audit", async () => {
  const t = await createTenant();
  const body = holiday(10, 12);
  const res = await post(body, t.adminToken);
  assert.equal(res.status, 201, JSON.stringify(res.body?.error));
  assert.deepEqual({ ...res.body!.data, id: "x" }, { id: "x", ...body, dayCount: 3, scope: "SCHOOL" });
  const row = await prisma.holiday.findFirst({ where: { id: res.body!.data.id } });
  assert.equal(row?.schoolId, t.schoolId);
  const audit = await findAudit(res.body!.data.id, "holiday.create");
  assert.equal(audit?.schoolId, t.schoolId);
});

test("body wajib tanpa schoolId: kunci schoolId (termasuk null) -> 400", async () => {
  const t = await createTenant();
  const names: string[] = [];
  for (const extra of [{ schoolId: null }, { schoolId: env.b.schoolId }, { schoolId: t.schoolId }]) {
    const body = holiday(5);
    names.push(body.name);
    const res = await post({ ...body, ...extra }, t.adminToken);
    assert.equal(res.status, 400, JSON.stringify(extra));
    assert.equal(res.body?.error?.code, "VALIDATION_FAILED");
  }
  assert.equal(await prisma.holiday.count({ where: { name: { in: names } } }), 0, "tidak ada libur (nasional/sekolah lain) yang tercipta");
});

test("validasi bentuk -> 400 dan aturan rentang -> 422", async () => {
  const t = await createTenant();
  for (const body of [{ ...holiday(5), name: "AB" }, { ...holiday(5), startDate: "2026-02-30" }, { name: "Libur Uji" }]) {
    assert.equal((await post(body, t.adminToken)).status, 400, JSON.stringify(body));
  }
  const reversed = await post(holiday(6, 5), t.adminToken);
  assert.equal(reversed.status, 422);
  assert.equal(reversed.body?.error?.code, "INVALID_DATE_RANGE");
  const tooLong = await post(holiday(1, 61), t.adminToken);
  assert.equal(tooLong.body?.error?.code, "HOLIDAY_TOO_LONG");
  assert.equal((await post(holiday(1, 60), t.adminToken)).status, 201, "tepat 60 hari diterima");
});

test("libur ganda (nama + tanggal mulai sama) -> 409", async () => {
  const t = await createTenant();
  const body = holiday(20);
  assert.equal((await post(body, t.adminToken)).status, 201);
  const dup = await post({ ...body, endDate: addDays(body.endDate, 1) }, t.adminToken);
  assert.equal(dup.status, 409);
  assert.equal(dup.body?.error?.code, "HOLIDAY_DUPLICATE");
});

test("POST libur ganda paralel -> satu 201 + satu 409 HOLIDAY_DUPLICATE", async () => {
  const t = await createTenant();
  const body = holiday(22);
  const held = await holdLock(holidaysLockKey(t.schoolId));
  const results = await raceWhileHeld(held, [() => post(body, t.adminToken), () => post(body, t.adminToken)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(results.find((r) => r.status === 409)?.body?.error?.code, "HOLIDAY_DUPLICATE");
  assert.equal(await prisma.holiday.count({ where: { schoolId: t.schoolId, name: body.name } }), 1);
});

test("PATCH libur paralel (nama & tanggal selesai) -> keduanya tersimpan", async () => {
  const t = await createTenant();
  const created = (await post(holiday(12, 12), t.adminToken)).body!.data;
  const held = await holdLock(holidaysLockKey(t.schoolId));
  const [renamed, extended] = await raceWhileHeld(held, [
    () => patch(created.id, { name: "Libur Paralel" }, t.adminToken),
    () => patch(created.id, { endDate: addDays(today, 14) }, t.adminToken),
  ]);
  assert.deepEqual([renamed?.status, extended?.status], [200, 200]);
  assert.deepEqual([extended?.body?.data.name, extended?.body?.data.endDate], ["Libur Paralel", addDays(today, 14)]);
  const row = await prisma.holiday.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(row.name, "Libur Paralel");
});

test("batas backdate admin sekolah: mulai >= hari ini - 7; super admin tanpa batas", async () => {
  const t = await createTenant();
  assert.equal((await post(holiday(-7), t.adminToken)).status, 201);
  const old = await post(holiday(-8), t.adminToken);
  assert.equal(old.status, 422);
  assert.equal(old.body?.error?.code, "HOLIDAY_BACKDATE_LIMIT");
  const bySuper = await post(holiday(-30, -29), env.superToken, t.schoolId);
  assert.equal(bySuper.status, 201);
  const id = bySuper.body!.data.id;
  assert.equal((await patch(id, { name: "Libur Diubah Admin" }, t.adminToken)).body?.error?.code, "HOLIDAY_BACKDATE_LIMIT");
  assert.equal((await remove(id, t.adminToken)).body?.error?.code, "HOLIDAY_BACKDATE_LIMIT");
  const recent = (await post(holiday(3), t.adminToken)).body!.data;
  const moved = await patch(recent.id, { startDate: addDays(today, -8) }, t.adminToken);
  assert.equal(moved.body?.error?.code, "HOLIDAY_BACKDATE_LIMIT");
  assert.equal((await patch(id, { name: "Libur Diubah Super" }, env.superToken, t.schoolId)).status, 200);
  assert.equal((await remove(id, env.superToken, t.schoolId)).status, 200);
});

test("PATCH & DELETE libur sekolah + audit; body PATCH kosong -> 400", async () => {
  const t = await createTenant();
  const created = (await post(holiday(4, 5), t.adminToken)).body!.data;
  const res = await patch(created.id, { endDate: addDays(today, 7), name: "  Libur   Semester  " }, t.adminToken);
  assert.equal(res.status, 200);
  assert.deepEqual([res.body?.data.name, res.body?.data.dayCount], ["Libur Semester", 4]);
  assert.ok(await findAudit(created.id, "holiday.update"));
  assert.equal((await patch(created.id, {}, t.adminToken)).status, 400);
  assert.equal((await patch(created.id, { schoolId: null }, t.adminToken)).status, 400);
  const del = await remove(created.id, t.adminToken);
  assert.equal(del.status, 200);
  assert.equal(await prisma.holiday.count({ where: { id: created.id } }), 0);
  assert.ok(await findAudit(created.id, "holiday.delete"));
});

test("GET: libur sekolah sendiri + libur nasional, filter tahun/bulan, tanpa libur sekolah lain", async () => {
  const own = await prisma.holiday.create({ data: { schoolId: env.a.schoolId, name: "Libur A", startDate: toDbDate("2093-03-10"), endDate: toDbDate("2093-03-12") } });
  const other = await prisma.holiday.create({ data: { schoolId: env.b.schoolId, name: "Libur B", startDate: toDbDate("2093-03-11"), endDate: toDbDate("2093-03-11") } });
  const national = await prisma.holiday.create({ data: { schoolId: null, name: "Libur Nasional Uji", startDate: toDbDate("2093-02-28"), endDate: toDbDate("2093-03-01") } });
  nationalIds.push(national.id);
  const year = await list(env.a.adminToken, "?year=2093");
  assert.equal(year.status, 200);
  const ids = year.body!.data.map((h) => h.id);
  assert.ok(ids.includes(own.id) && ids.includes(national.id));
  assert.equal(ids.includes(other.id), false);
  assert.equal(year.body!.data.find((h) => h.id === national.id)?.scope, "NATIONAL");
  const march = await list(env.a.adminToken, "?year=2093&month=3");
  assert.deepEqual(march.body?.data.map((h) => h.id).sort(), [own.id, national.id].sort(), "libur nasional yang melintas bulan ikut");
  assert.deepEqual((await list(env.a.adminToken, "?year=2093&month=4")).body?.data.filter((h) => [own.id, national.id].includes(h.id)), []);
  assert.equal((await list(env.a.adminToken, "?month=13")).status, 400);
  const current = await list(env.a.adminToken);
  assert.equal(current.status, 200, "default tahun berjalan");
});

test("libur nasional tidak bisa diubah/dihapus lewat /school/holidays -> 404", async () => {
  const national = await prisma.holiday.create({ data: { schoolId: null, name: uniq("Nasional"), startDate: toDbDate(addDays(today, 30)), endDate: toDbDate(addDays(today, 30)) } });
  nationalIds.push(national.id);
  assert.equal((await patch(national.id, { name: "Dibajak Admin" }, env.a.adminToken)).status, 404);
  assert.equal((await remove(national.id, env.a.adminToken)).status, 404);
  assert.equal((await remove(national.id, env.superToken, env.a.schoolId)).status, 404);
});

test("peran salah -> 403", async () => {
  assert.equal((await list(env.studentToken)).status, 403);
  assert.equal((await post(holiday(5), env.studentToken)).status, 403);
});

test("IDOR dua sekolah pada libur sekolah", async () => {
  const created = (await post(holiday(8), env.a.adminToken)).body!.data;
  assert.equal((await patch(created.id, { name: "Libur Dibajak" }, env.b.adminToken)).status, 404);
  assert.equal((await remove(created.id, env.b.adminToken)).status, 404);
  assert.equal((await post(holiday(8), env.a.adminToken, env.b.schoolId)).body?.error?.code, "SCOPE_MISMATCH");
  assert.equal((await post(holiday(8), env.superToken)).body?.error?.code, "SCHOOL_ID_REQUIRED");
  assert.equal((await post(holiday(8), env.superToken, "sekolah-tidak-ada")).status, 404);
  assert.equal((await patch(created.id, { name: "Libur Dibajak" }, env.superToken, env.b.schoolId)).status, 404);
  const listB = await list(env.b.adminToken, `?year=${created.startDate.slice(0, 4)}`);
  assert.equal(listB.body?.data.some((h) => h.id === created.id), false);
});
