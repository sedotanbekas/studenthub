import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/platform/holidays/route";
import { DELETE as deleteRoute, PATCH as patchRoute } from "@/app/api/v1/platform/holidays/[id]/route";
import { GET as listSchoolRoute } from "@/app/api/v1/school/holidays/route";
import type { ActionContext } from "@/lib/auth/principal";
import type { NationalHolidayEntry } from "@/lib/calendar/national-import";
import { importNationalHolidays } from "@/lib/calendar/national-import-service";
import { holidaysLockKey } from "@/lib/lock-keys";
import { toDbDate } from "@/lib/time/zone";
import { disconnect, prisma, uniq } from "../helpers/db";
import { callRoute, type Envelope } from "../helpers/request";
import { findAudit, holdLock, raceWhileHeld, setupTenants, type TwoTenants } from "../academics/helpers";

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
/** Tahun khusus uji impor: harus bebas libur nasional sebelum impor pertama (impor melewati tahun terisi). */
const IMPORT_YEARS = ["2095", "2096"] as const;
const created: string[] = [];

const nationalInYears = (years: readonly string[]) => ({
  schoolId: null,
  OR: years.map((y) => ({ startDate: { gte: toDbDate(`${y}-01-01`), lte: toDbDate(`${y}-12-31`) } })),
});

let env: TwoTenants;
before(async () => {
  await prisma.holiday.deleteMany({ where: nationalInYears(IMPORT_YEARS) });
  env = await setupTenants();
});
after(async () => {
  await prisma.holiday.deleteMany({ where: { OR: [{ id: { in: created } }, nationalInYears([YEAR, ...IMPORT_YEARS])] } });
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

test("POST libur nasional ganda paralel -> satu 201 + satu 409 HOLIDAY_DUPLICATE", async () => {
  const dup = body("07-07");
  const held = await holdLock(holidaysLockKey(null));
  const results = await raceWhileHeld(held, [() => post(dup, env.superToken), () => post(dup, env.superToken)]);
  created.push(...results.flatMap((r) => (r.status === 201 ? [r.body!.data.id] : [])));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(results.find((r) => r.status === 409)?.body?.error?.code, "HOLIDAY_DUPLICATE");
  assert.equal(await prisma.holiday.count({ where: { schoolId: null, name: dup.name } }), 1);
});

const importCtx = (): ActionContext => ({ principal: null, now: new Date(), requestId: uniq("test-import"), ip: null, userAgent: null, defer: () => undefined });

const importEntry = (startDate: string, endDate = startDate, kind: NationalHolidayEntry["kind"] = "LIBUR_NASIONAL"): NationalHolidayEntry => ({
  name: uniq("Impor"), startDate, endDate, kind, source: "https://setneg.go.id/uji",
});

test("impor: tahun baru dibuat, tahun yang sudah punya libur nasional dilewati; --force cocok nama + tanggal mulai", async () => {
  const year = IMPORT_YEARS[0];
  const ctx = importCtx();
  const entries = [importEntry(`${year}-06-01`), importEntry(`${year}-06-10`, `${year}-06-11`, "CUTI_BERSAMA")];
  assert.deepEqual(await importNationalHolidays(entries, ctx), { created: 2, updated: 0, unchanged: 0, skippedYears: [] });
  assert.deepEqual(await importNationalHolidays(entries, ctx), { created: 0, updated: 0, unchanged: 0, skippedYears: [{ year, entries: 2 }] });
  assert.deepEqual(await importNationalHolidays(entries, ctx, { force: true }), { created: 0, updated: 0, unchanged: 2, skippedYears: [] });
  const changed = entries.map((e, i) => (i === 1 ? { ...e, endDate: `${year}-06-12` } : e));
  assert.deepEqual(await importNationalHolidays(changed, ctx, { force: true }), { created: 0, updated: 1, unchanged: 1, skippedYears: [] });
  const rows = await prisma.holiday.findMany({ where: { name: { in: entries.map((e) => e.name) } }, orderBy: { startDate: "asc" } });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.schoolId === null));
  assert.equal(rows[1]?.endDate.toISOString().slice(0, 10), `${year}-06-12`);
  assert.equal(await prisma.auditLog.count({ where: { action: "national_holiday.import", entityId: { in: rows.map((r) => r.id) } } }), 3);
});

test("impor ulang tidak menghidupkan lagi libur yang diedit/dihapus super admin lewat API", async () => {
  const year = IMPORT_YEARS[1];
  const entries = [importEntry(`${year}-01-01`), importEntry(`${year}-02-02`)];
  assert.equal((await importNationalHolidays(entries, importCtx())).created, 2);
  const [first, second] = await prisma.holiday.findMany({ where: { name: { in: entries.map((e) => e.name) } }, orderBy: { startDate: "asc" } });
  const renamed = uniq("Diganti Super Admin");
  assert.equal((await patch(first!.id, { name: renamed }, env.superToken)).status, 200);
  assert.equal((await remove(second!.id, env.superToken)).status, 200);
  const again = await importNationalHolidays(entries, importCtx());
  assert.deepEqual(again, { created: 0, updated: 0, unchanged: 0, skippedYears: [{ year, entries: 2 }] });
  const rows = await prisma.holiday.findMany({ where: nationalInYears([year]) });
  assert.deepEqual(rows.map((r) => r.name), [renamed], "yang dihapus tidak dibuat ulang, yang diedit tidak digandakan");
  const forced = await importNationalHolidays(entries, importCtx(), { force: true });
  assert.equal(forced.created, 2, "--force = perilaku lama (cocok nama + tanggal mulai) -> semua dibuat ulang");
});
