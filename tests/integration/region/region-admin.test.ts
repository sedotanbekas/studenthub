/**
 * Admin Pemda (REGION_ADMIN, 2026-10-07): dibuat super admin lewat /platform/users, melihat sekolah di provinsi/kota
 * wilayahnya saja (/region/schools + /school/* dengan ?schoolId=), sekolah di luar wilayah 404, perubahan 403.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { School } from "@prisma/client";
import { GET as meRoute } from "@/app/api/v1/auth/me/route";
import { POST as createUserRoute } from "@/app/api/v1/platform/users/route";
import { GET as regionSchoolsRoute } from "@/app/api/v1/region/schools/route";
import { GET as invoicesRoute } from "@/app/api/v1/school/invoices/route";
import { GET as studentsRoute, POST as createStudentRoute } from "@/app/api/v1/school/students/route";
import { superFx, webToken } from "../ads/fixtures";
import { disconnect, prisma } from "../helpers/db";
import { createSchool, uniqEmail } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";

let superToken = "";
let depok: School;
let bandung: School;
let jakarta: School;

before(async () => {
  superToken = (await superFx()).token;
  [depok, bandung, jakarta] = await Promise.all([
    createSchool({ provinceCode: "32", cityCode: "32.76" }),
    createSchool({ provinceCode: "32", cityCode: "32.73" }),
    createSchool({ provinceCode: "31", cityCode: "31.71" }),
  ]);
});
after(disconnect);

interface CreatedUser { user: { id: string; role: string; region: { provinceName: string; cityName: string | null } | null } }

const createRegionAdmin = (json: Record<string, unknown>) =>
  callRoute<Envelope<CreatedUser>>(createUserRoute, { method: "POST", url: "/api/v1/platform/users", bearer: superToken, json: { role: "REGION_ADMIN", name: "Admin Pemda Uji", email: uniqEmail("pd"), initialPassword: "Pemda#Uji2026", ...json } });

async function regionToken(json: Record<string, unknown>): Promise<string> {
  const res = await createRegionAdmin(json);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  // Akun baru wajib ganti kata sandi saat masuk pertama; test langsung memakai akunnya.
  await prisma.user.update({ where: { id: res.body!.data.user.id }, data: { mustChangePassword: false } });
  return webToken(res.body!.data.user.id);
}

const ids = (rows: { id: string }[] | undefined) => new Set((rows ?? []).map((r) => r.id));
const listSchools = (token: string, q?: string) =>
  callRoute<Envelope<{ id: string }[]>>(regionSchoolsRoute, { method: "GET", url: `/api/v1/region/schools?limit=100${q ? `&q=${encodeURIComponent(q)}` : ""}`, bearer: token });
/** DB test dipakai ulang (banyak sekolah di provinsi 32): cari per nama sekolah uji. */
async function visible(token: string, school: School): Promise<boolean> {
  return ids((await listSchools(token, school.name)).body?.data).has(school.id);
}
const students = (token: string, schoolId?: string) =>
  callRoute<Envelope>(studentsRoute, { method: "GET", url: `/api/v1/school/students${schoolId ? `?schoolId=${schoolId}` : ""}`, bearer: token });

test("buat akun: provinsi wajib, kota harus di provinsinya, tanpa sekolah; wilayah tampil di akun", async () => {
  assert.equal((await createRegionAdmin({})).body?.error?.code, "REGION_REQUIRED");
  assert.equal((await createRegionAdmin({ regionProvinceCode: "32", regionCityCode: "31.71" })).body?.error?.code, "CITY_NOT_IN_PROVINCE");
  assert.equal((await createRegionAdmin({ regionProvinceCode: "32", schoolId: depok.id })).body?.error?.code, "SCHOOL_ID_NOT_ALLOWED");
  assert.equal((await createRegionAdmin({ regionProvinceCode: "99" })).body?.error?.code, "REGION_INVALID");
  const ok = await createRegionAdmin({ regionProvinceCode: "32", regionCityCode: "32.76" });
  assert.equal(ok.status, 201);
  assert.deepEqual([ok.body?.data.user.role, ok.body?.data.user.region?.cityName], ["REGION_ADMIN", "Kota Depok"]);
  const wrong = await callRoute<Envelope>(createUserRoute, { method: "POST", url: "/api/v1/platform/users", bearer: superToken, json: { role: "SUPER_ADMIN", name: "Super Uji", email: uniqEmail("sa"), regionProvinceCode: "32" } });
  assert.equal(wrong.body?.error?.code, "REGION_NOT_ALLOWED");
});

test("admin provinsi: semua sekolah di provinsinya; admin kota: kotanya saja", async () => {
  const province = await regionToken({ regionProvinceCode: "32" });
  const city = await regionToken({ regionProvinceCode: "32", regionCityCode: "32.76" });
  assert.deepEqual([await visible(province, depok), await visible(province, bandung), await visible(province, jakarta)], [true, true, false]);
  assert.deepEqual([await visible(city, depok), await visible(city, bandung), await visible(city, jakarta)], [true, false, false]);
  const me = await callRoute<Envelope<{ region: { provinceName: string; cityName: string | null }; permissions: string[] }>>(meRoute, { method: "GET", url: "/api/v1/auth/me", bearer: city });
  assert.deepEqual([me.body?.data.region.provinceName, me.body?.data.region.cityName], ["Jawa Barat", "Kota Depok"]);
  assert.ok(me.body?.data.permissions.includes("billing.read") && !me.body?.data.permissions.includes("billing.write"));
});

test("data sekolah: baca di wilayah 200, luar wilayah 404, tanpa schoolId 400, perubahan 403", async () => {
  const city = await regionToken({ regionProvinceCode: "32", regionCityCode: "32.76" });
  assert.equal((await students(city, depok.id)).status, 200);
  assert.equal((await callRoute(invoicesRoute, { method: "GET", url: `/api/v1/school/invoices?schoolId=${depok.id}`, bearer: city })).status, 200);
  const outside = await students(city, bandung.id);
  assert.deepEqual([outside.status, outside.body?.error?.code], [404, "SCHOOL_NOT_FOUND"]);
  assert.equal((await students(city, "tidak-ada")).status, 404);
  assert.equal((await students(city)).body?.error?.code, "SCHOOL_ID_REQUIRED");
  const write = await callRoute<Envelope>(createStudentRoute, { method: "POST", url: `/api/v1/school/students?schoolId=${depok.id}`, bearer: city, json: { name: "Siswa", nisn: "0099887766", nis: "1", gender: "MALE" } });
  assert.equal(write.status, 403);
});

test("peran lain tidak boleh membuka daftar sekolah wilayah", async () => {
  assert.equal((await listSchools(superToken)).status, 403);
});
