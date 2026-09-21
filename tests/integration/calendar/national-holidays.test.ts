import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/platform/holidays/route";
import { DELETE as deleteRoute, PATCH as patchRoute } from "@/app/api/v1/platform/holidays/[id]/route";
import { GET as listSchoolRoute } from "@/app/api/v1/school/holidays/route";
import type { ActionContext } from "@/lib/auth/principal";
import type { NationalHolidayEntry } from "@/lib/calendar/national-import";
import { importNationalHolidays } from "@/lib/calendar/national-import-service";
import { toDbDate } from "@/lib/time/zone";
import { disconnect, prisma, uniq } from "../helpers/db";
import { callRoute, type Envelope } from "../helpers/request";
import { findAudit, setupTenants, type TwoTenants } from "../academics/helpers";

interface Holiday {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  dayCount: number;
  scope: "SCHOOL" | "NATIONAL";
}

const BASE = "/api/v1/platform/holidays";
/** Semua data uji di tahun 2094 agar tidak memengaruhi kalender domain lain; dibersihkan di after(). */
const YEAR = "2094";
const created: string[] = [];

let env: TwoTenants;
before(async () => {
  env = await setupTenants();
});
after(async () => {
  await prisma.holiday.deleteMany({ where: { OR: [{ id: { in: created } }, { schoolId: null, startDate: { gte: toDbDate(`${YEAR}-01-01`), lte: toDbDate(`${YEAR}-12-31`) } }] } });
  await disconnect();
});

const list = (token: string, query = `?year=${YEAR}`) => callRoute<Envelope<Holiday[]>>(listRoute, { method: "GET", url: `${BASE}${query}`, bearer: token });
const post = (body: unknown, token: string) => callRoute<Envelope<Holiday>>(createRoute, { method: "POST", url: BASE, bearer: token, json: body });
const patch = (id: string, body: unknown, token: string) =>
  callRoute<Envelope<Holiday>>(patchRoute, { method: "PATCH", url: `${BASE}/${id}`, bearer: token, json: body, params: { id } });
const remove = (id: string, token: string) => callRoute<Envelope<{ id: string }>>(deleteRoute, { method: "DELETE", url: `${BASE}/${id}`, bearer: token, params: { id } });

const body = (start: string, end = start) => ({ name: uniq("Libur Nasional"), startDate: `${YEAR}-${start}`, endDate: `${YEAR}-${end}` });

async function createNational(start: string, end = start): Promise<Holiday> {
  const res = await post(body(start, end), env.superToken);
  assert.equal(res.status, 201, JSON.stringify(res.body?.error));
  created.push(res.body!.data.id);
  return res.body!.data;
}

test("super admin menambah libur nasional -> 201 scope NATIONAL, terlihat semua sekolah", async () => {
  const holiday = await createNational("08-17");
  assert.equal(holiday.scope, "NATIONAL");
  const row = await prisma.holiday.findFirst({ where: { id: holiday.id } });
  assert.equal(row?.schoolId, null);
  assert.ok(await findAudit(holiday.id, "national_holiday.create"));
  assert.ok((await list(env.superToken)).body?.data.some((h) => h.id === holiday.id));
  for (const tenant of [env.a, env.b]) {
    const res = await callRoute<Envelope<Holiday[]>>(listSchoolRoute, { method: "GET", url: `/api/v1/school/holidays?year=${YEAR}`, bearer: tenant.adminToken });
    assert.ok(res.body?.data.some((h) => h.id === holiday.id));
  }
});

test("libur nasional lama tetap boleh dibuat super admin (tanpa batas backdate)", async () => {
  const res = await post({ name: uniq("Libur Lama"), startDate: "2020-01-01", endDate: "2020-01-01" }, env.superToken);
  assert.equal(res.status, 201);
  created.push(res.body!.data.id);
});

test("validasi: 400 bentuk & kunci asing, 422 rentang, 409 ganda", async () => {
  for (const bad of [{ ...body("01-02"), schoolId: env.a.schoolId }, { ...body("01-02"), name: "AB" }, { name: "Libur" }]) {
    assert.equal((await post(bad, env.superToken)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await post(body("01-05", "01-04"), env.superToken)).body?.error?.code, "INVALID_DATE_RANGE");
  assert.equal((await post(body("01-01", "03-02"), env.superToken)).body?.error?.code, "HOLIDAY_TOO_LONG");
  const first = await createNational("02-10");
  const dup = await post({ name: first.name, startDate: first.startDate, endDate: first.endDate }, env.superToken);
  assert.equal(dup.status, 409);
  assert.equal(dup.body?.error?.code, "HOLIDAY_DUPLICATE");
});

test("PATCH & DELETE libur nasional + audit", async () => {
  const holiday = await createNational("03-10");
  const res = await patch(holiday.id, { endDate: `${YEAR}-03-12` }, env.superToken);
  assert.equal(res.status, 200);
  assert.equal(res.body?.data.dayCount, 3);
  assert.ok(await findAudit(holiday.id, "national_holiday.update"));
  assert.equal((await patch(holiday.id, {}, env.superToken)).status, 400);
  const del = await remove(holiday.id, env.superToken);
  assert.equal(del.status, 200);
  assert.equal(await prisma.holiday.count({ where: { id: holiday.id } }), 0);
  assert.ok(await findAudit(holiday.id, "national_holiday.delete"));
});

test("libur sekolah tidak bisa diubah lewat /platform/holidays -> 404", async () => {
  const school = await prisma.holiday.create({ data: { schoolId: env.a.schoolId, name: uniq("Libur Sekolah"), startDate: toDbDate(`${YEAR}-04-01`), endDate: toDbDate(`${YEAR}-04-01`) } });
  created.push(school.id);
  assert.equal((await patch(school.id, { name: "Dibajak Super" }, env.superToken)).status, 404);
  assert.equal((await remove(school.id, env.superToken)).status, 404);
  assert.equal((await list(env.superToken)).body?.data.some((h) => h.id === school.id), false);
});

test("admin sekolah & siswa ditolak 403 untuk libur nasional", async () => {
  const holiday = await createNational("05-05");
  for (const token of [env.a.adminToken, env.studentToken]) {
    const res = await post(body("05-06"), token);
    assert.equal(res.status, 403);
    assert.equal(res.body?.error?.code, "FORBIDDEN");
    assert.equal((await patch(holiday.id, { name: "Dibajak Admin" }, token)).status, 403);
    assert.equal((await remove(holiday.id, token)).status, 403);
    assert.equal((await list(token)).status, 403);
  }
});

test("impor libur nasional idempoten: buat, lewati yang sama, perbarui endDate", async () => {
  const ctx: ActionContext = { principal: null, now: new Date(), requestId: "test-import", ip: null, userAgent: null, defer: () => undefined };
  const entries: NationalHolidayEntry[] = [
    { name: uniq("Impor A"), startDate: `${YEAR}-06-01`, endDate: `${YEAR}-06-01`, kind: "LIBUR_NASIONAL", source: "https://setneg.go.id/uji" },
    { name: uniq("Impor B"), startDate: `${YEAR}-06-10`, endDate: `${YEAR}-06-11`, kind: "CUTI_BERSAMA", source: "https://setneg.go.id/uji" },
  ];
  assert.deepEqual(await importNationalHolidays(entries, ctx), { created: 2, updated: 0, unchanged: 0 });
  assert.deepEqual(await importNationalHolidays(entries, ctx), { created: 0, updated: 0, unchanged: 2 });
  const changed = entries.map((e, i) => (i === 1 ? { ...e, endDate: `${YEAR}-06-12` } : e));
  assert.deepEqual(await importNationalHolidays(changed, ctx), { created: 0, updated: 1, unchanged: 1 });
  const rows = await prisma.holiday.findMany({ where: { name: { in: entries.map((e) => e.name) } }, orderBy: { startDate: "asc" } });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.schoolId === null));
  assert.equal(rows[1]?.endDate.toISOString().slice(0, 10), `${YEAR}-06-12`);
  assert.equal(await prisma.auditLog.count({ where: { action: "national_holiday.import", entityId: { in: rows.map((r) => r.id) } } }), 3);
});
