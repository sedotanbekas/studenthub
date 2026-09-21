import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { GET as listSchools, POST as createSchoolRoute } from "@/app/api/v1/platform/schools/route";
import { GET as getSchool, PATCH as patchSchool } from "@/app/api/v1/platform/schools/[id]/route";
import { POST as deactivateSchool } from "@/app/api/v1/platform/schools/[id]/deactivate/route";
import { POST as reactivateSchool } from "@/app/api/v1/platform/schools/[id]/reactivate/route";
import { GET as listProvinces } from "@/app/api/v1/regions/provinces/route";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma, uniq } from "../helpers/db";
import { createSchool, createSchoolAdmin, createStudent } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { newSchoolBody, setupTwoSchools, uniqNpsn, type TwoSchools } from "./fixtures";

type SchoolBody = Record<string, unknown> & {
  id: string;
  counts: { studentsByStatus: Record<string, number>; adminCount: number; activeAdminCount: number };
};
type ErrorDetails = { errors: Array<{ field: string; code: string }> };

let fx: TwoSchools;

before(async () => {
  resetAllLimiters();
  fx = await setupTwoSchools();
});
after(disconnect);

const create = (token: string, json: unknown) =>
  callRoute<Envelope<SchoolBody>>(createSchoolRoute, { method: "POST", url: "/api/v1/platform/schools", bearer: token, json });
const patch = (token: string, id: string, json: unknown) =>
  callRoute<Envelope<SchoolBody>>(patchSchool, { method: "PATCH", url: `/api/v1/platform/schools/${id}`, bearer: token, params: { id }, json });
const detail = (token: string, id: string) =>
  callRoute<Envelope<SchoolBody>>(getSchool, { method: "GET", url: `/api/v1/platform/schools/${id}`, bearer: token, params: { id } });
const deactivate = (token: string, id: string, json: unknown) =>
  callRoute<Envelope<{ id: string; isActive: boolean; revokedSessions: number }>>(deactivateSchool, {
    method: "POST",
    url: `/api/v1/platform/schools/${id}/deactivate`,
    bearer: token,
    params: { id },
    json,
  });
const reactivate = (token: string, id: string) =>
  callRoute<Envelope<{ id: string; isActive: boolean }>>(reactivateSchool, { method: "POST", url: `/api/v1/platform/schools/${id}/reactivate`, bearer: token, params: { id } });

describe("POST /platform/schools", () => {
  test("membuat sekolah dengan default jadwal + audit school.create", async () => {
    const npsn = uniqNpsn();
    const res = await create(fx.sa.token, newSchoolBody({ npsn, address: "Jl. Uji No. 1" }));
    assert.equal(res.status, 201);
    const school = res.body?.data;
    assert.ok(school);
    assert.equal(school.npsn, npsn);
    assert.deepEqual(school.province, { code: "32", name: (await prisma.province.findUniqueOrThrow({ where: { code: "32" } })).name });
    assert.equal(school.startMinute, 420);
    assert.equal(school.geofenceRadiusM, 150);
    assert.deepEqual(school.schedule, { checkInOpen: "06:00", start: "07:00", lateAfter: "07:15", checkInClose: "10:00", dayEnd: "15:00" });
    assert.deepEqual(school.schoolDays, ["MON", "TUE", "WED", "THU", "FRI"]);
    assert.equal(school.geofenceUpdatedAt, null);
    assert.deepEqual(school.counts, { studentsByStatus: { DRAFT: 0, ACTIVE: 0, INACTIVE: 0, GRADUATED: 0, MOVED: 0 }, adminCount: 0, activeAdminCount: 0 });
    const audit = await prisma.auditLog.findFirst({ where: { entityId: school.id, action: "school.create" } });
    assert.equal(audit?.actorId, fx.sa.user.id);
    assert.equal(audit?.schoolId, school.id);
  });

  test("kolom opsional & rekening lengkap tersimpan; koordinat dibulatkan 7 desimal", async () => {
    const body = newSchoolBody({ latitude: -6.123456789, geofenceRadiusM: 300, schoolDaysMask: 63, bankName: "BCA", bankAccountNumber: "1234567890", bankAccountHolder: "Yayasan Uji" });
    const res = await create(fx.sa.token, body);
    assert.equal(res.status, 201);
    assert.equal(res.body?.data.latitude, -6.1234568);
    assert.equal(res.body?.data.bankAccountNumber, "1234567890");
    assert.equal(res.body?.data.bankChangedAt, null);
  });

  test("validasi bentuk -> 400", async () => {
    const missing = await create(fx.sa.token, { provinceCode: "32" });
    assert.equal(missing.status, 400);
    assert.equal(missing.body?.error?.code, "VALIDATION_FAILED");
    const unknownKey = await create(fx.sa.token, newSchoolBody({ isActive: false }));
    assert.equal(unknownKey.status, 400);
    const fraction = await create(fx.sa.token, newSchoolBody({ startMinute: 420.5 }));
    assert.equal(fraction.status, 400);
  });

  test("aturan konfigurasi -> 422 SCHOOL_CONFIG_INVALID dengan detail per kolom", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ latitude: 10 }, "LATITUDE_OUT_OF_RANGE"],
      [{ longitude: 90 }, "LONGITUDE_OUT_OF_RANGE"],
      [{ geofenceRadiusM: 49 }, "RADIUS_OUT_OF_RANGE"],
      [{ checkInCloseMinute: 430 }, "LATE_THRESHOLD_NOT_BEFORE_CLOSE"],
      [{ dayEndMinute: 1440 }, "SCHEDULE_DAY_END_TOO_LATE"],
      [{ schoolDaysMask: 0 }, "SCHOOL_DAYS_MASK_OUT_OF_RANGE"],
      [{ npsn: "1234" }, "NPSN_INVALID"],
      [{ bankName: "BCA" }, "BANK_INCOMPLETE"],
      [{ bankName: "BCA", bankAccountNumber: "12-34", bankAccountHolder: "X" }, "BANK_ACCOUNT_NUMBER_INVALID"],
    ];
    for (const [overrides, code] of cases) {
      const res = await create(fx.sa.token, newSchoolBody(overrides));
      assert.equal(res.status, 422, code);
      assert.equal(res.body?.error?.code, "SCHOOL_CONFIG_INVALID");
      assert.ok((res.body?.error?.details as ErrorDetails).errors.some((e) => e.code === code), code);
    }
  });

  test("kabupaten/kota harus milik provinsi -> 422", async () => {
    const res = await create(fx.sa.token, newSchoolBody({ provinceCode: "32", cityCode: "31.71" }));
    assert.equal(res.status, 422);
    assert.equal(res.body?.error?.code, "CITY_NOT_IN_PROVINCE");
    const unknownCity = await create(fx.sa.token, newSchoolBody({ cityCode: "32.99" }));
    assert.equal(unknownCity.body?.error?.code, "CITY_NOT_IN_PROVINCE");
  });

  test("NPSN ganda -> 409 NPSN_TAKEN", async () => {
    const npsn = uniqNpsn();
    assert.equal((await create(fx.sa.token, newSchoolBody({ npsn }))).status, 201);
    const dup = await create(fx.sa.token, newSchoolBody({ npsn }));
    assert.equal(dup.status, 409);
    assert.equal(dup.body?.error?.code, "NPSN_TAKEN");
  });

  test("peran selain super admin -> 403", async () => {
    for (const token of [fx.adminA.token, fx.student.token, fx.sponsor.token]) {
      const res = await create(token, newSchoolBody());
      assert.equal(res.status, 403);
    }
    const list = await callRoute(listSchools, { method: "GET", url: "/api/v1/platform/schools", bearer: fx.adminA.token });
    assert.equal(list.status, 403);
  });
});

describe("GET /platform/schools & /platform/schools/{id}", () => {
  test("cari nama + jumlah siswa aktif + meta paginasi", async () => {
    const marker = uniq("cari");
    const school = await createSchool({ data: { name: `SMA ${marker}` } });
    await Promise.all([createStudent(school.id), createStudent(school.id), createStudent(school.id, { status: "DRAFT" })]);
    const res = await callRoute<Envelope<Array<{ id: string; activeStudentCount: number; city: { code: string } }>>>(listSchools, {
      method: "GET",
      url: `/api/v1/platform/schools?q=${encodeURIComponent(marker)}&provinceCode=32&isActive=true`,
      bearer: fx.sa.token,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body?.data.length, 1);
    assert.equal(res.body?.data[0]?.activeStudentCount, 2);
    assert.equal(res.body?.data[0]?.city.code, "32.73");
    assert.deepEqual(res.body?.meta, { total: 1, page: 1, limit: 20, totalPages: 1 });
    const inactive = await callRoute<Envelope<unknown[]>>(listSchools, {
      method: "GET",
      url: `/api/v1/platform/schools?q=${encodeURIComponent(marker)}&isActive=false`,
      bearer: fx.sa.token,
    });
    assert.equal(inactive.body?.data.length, 0);
  });

  test("query tidak valid -> 400", async () => {
    for (const qs of ["limit=101", "isActive=ya", "provinceCode=3"]) {
      const res = await callRoute(listSchools, { method: "GET", url: `/api/v1/platform/schools?${qs}`, bearer: fx.sa.token });
      assert.equal(res.status, 400, qs);
    }
  });

  test("detail memuat jumlah siswa per status & admin", async () => {
    const school = await createSchool();
    await Promise.all([createStudent(school.id), createStudent(school.id, { status: "GRADUATED" }), createSchoolAdmin(school.id), createSchoolAdmin(school.id, { isActive: false })]);
    const res = await detail(fx.sa.token, school.id);
    assert.equal(res.status, 200);
    assert.equal(res.body?.data.counts.studentsByStatus.ACTIVE, 1);
    assert.equal(res.body?.data.counts.studentsByStatus.GRADUATED, 1);
    assert.equal(res.body?.data.counts.adminCount, 2);
    assert.equal(res.body?.data.counts.activeAdminCount, 1);
  });

  test("id tidak dikenal -> 404; admin sekolah -> 403", async () => {
    assert.equal((await detail(fx.sa.token, "tidak-ada")).status, 404);
    assert.equal((await detail(fx.adminA.token, fx.schoolA.id)).status, 403);
  });
});

describe("PATCH /platform/schools/{id}", () => {
  test("ubah rekening: bankChangedAt terisi, audit before/after, notifikasi ke admin aktif saja", async () => {
    const school = await createSchool();
    const active = await createSchoolAdmin(school.id);
    const inactive = await createSchoolAdmin(school.id, { isActive: false });
    const res = await patch(fx.sa.token, school.id, { bankName: "BRI", bankAccountNumber: "9876543210", bankAccountHolder: "Yayasan Baru" });
    assert.equal(res.status, 200);
    assert.ok(res.body?.data.bankChangedAt);
    assert.equal(res.body?.data.geofenceUpdatedAt, null);
    const note = await prisma.notification.findFirst({ where: { userId: active.id, type: "SCHOOL_SETTINGS_CHANGED" } });
    assert.equal(note?.title, "Rekening SPP sekolah diubah");
    assert.match(note?.body ?? "", /\*\*\*\*3210/);
    assert.equal(await prisma.notification.count({ where: { userId: inactive.id } }), 0);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: school.id, action: "school.update" } });
    assert.deepEqual(audit.before, { bankName: null, bankAccountNumber: null, bankAccountHolder: null });
    assert.deepEqual(audit.after, { bankName: "BRI", bankAccountNumber: "9876543210", bankAccountHolder: "Yayasan Baru" });
  });

  test("ubah geofence/zona waktu: geofenceUpdatedAt terisi", async () => {
    const school = await createSchool();
    const res = await patch(fx.sa.token, school.id, { latitude: -6.95, geofenceRadiusM: 250, timezone: "WITA" });
    assert.equal(res.status, 200);
    assert.ok(res.body?.data.geofenceUpdatedAt);
    assert.equal(res.body?.data.bankChangedAt, null);
    assert.equal(res.body?.data.timezone, "WITA");
    const row = await prisma.school.findUniqueOrThrow({ where: { id: school.id } });
    assert.equal(row.latitude.toNumber(), -6.95);
    assert.equal(row.geofenceRadiusM, 250);
  });

  test("patch tanpa perubahan nyata: tanpa audit & notifikasi", async () => {
    const school = await createSchool();
    await createSchoolAdmin(school.id);
    const res = await patch(fx.sa.token, school.id, { startMinute: school.startMinute, name: school.name });
    assert.equal(res.status, 200);
    assert.equal(await prisma.auditLog.count({ where: { entityId: school.id, action: "school.update" } }), 0);
  });

  test("hasil merge tidak valid -> 422 dan data tidak berubah", async () => {
    const school = await createSchool();
    const res = await patch(fx.sa.token, school.id, { checkInCloseMinute: 430 });
    assert.equal(res.status, 422);
    assert.equal(res.body?.error?.code, "SCHOOL_CONFIG_INVALID");
    assert.equal((await prisma.school.findUniqueOrThrow({ where: { id: school.id } })).checkInCloseMinute, 600);
    const region = await patch(fx.sa.token, school.id, { cityCode: "31.71" });
    assert.equal(region.body?.error?.code, "CITY_NOT_IN_PROVINCE");
    const bank = await patch(fx.sa.token, school.id, { bankName: "BCA" });
    assert.equal(bank.status, 422);
  });

  test("ganti provinsi + kota sekaligus & kosongkan rekening dengan null", async () => {
    const school = await createSchool({ data: { bankName: "BCA", bankAccountNumber: "12345", bankAccountHolder: "X" } });
    const res = await patch(fx.sa.token, school.id, { provinceCode: "31", cityCode: "31.71", bankName: null, bankAccountNumber: null, bankAccountHolder: null });
    assert.equal(res.status, 200);
    assert.equal(res.body?.data.bankName, null);
    assert.ok(res.body?.data.bankChangedAt);
    assert.equal((res.body?.data.city as { code: string }).code, "31.71");
  });

  test("validasi & konflik: body kosong/kunci asing 400, NPSN milik sekolah lain 409, id asing 404", async () => {
    assert.equal((await patch(fx.sa.token, fx.schoolA.id, {})).status, 400);
    assert.equal((await patch(fx.sa.token, fx.schoolA.id, { isActive: false })).status, 400);
    const npsn = uniqNpsn();
    await createSchool({ data: { npsn } });
    const dup = await patch(fx.sa.token, fx.schoolB.id, { npsn });
    assert.equal(dup.status, 409);
    assert.equal(dup.body?.error?.code, "NPSN_TAKEN");
    assert.equal((await patch(fx.sa.token, "tidak-ada", { name: "Nama Baru" })).status, 404);
  });

  test("admin sekolah tidak boleh PATCH /platform/schools (termasuk sekolahnya sendiri) -> 403", async () => {
    const res = await patch(fx.adminA.token, fx.schoolA.id, { latitude: -6.2 });
    assert.equal(res.status, 403);
    assert.equal(res.body?.error?.code, "FORBIDDEN");
  });
});

describe("POST /platform/schools/{id}/deactivate & reactivate", () => {
  test("nonaktifkan: sesi pengguna sekolah dicabut, token lama 401, audit tercatat", async () => {
    const school = await createSchool();
    const admin = await createSchoolAdmin(school.id);
    const student = await createStudent(school.id);
    const adminSession = await createSessionToken(admin.id, { platform: "WEB", deviceId: null });
    await createSessionToken(student.user.id);
    const before = await callRoute(listProvinces, { method: "GET", url: "/api/v1/regions/provinces", bearer: adminSession.token });
    assert.equal(before.status, 200);

    const res = await deactivate(fx.sa.token, school.id, { reason: "Kontrak berakhir" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body?.data, { id: school.id, isActive: false, revokedSessions: 2 });
    const afterRes = await callRoute(listProvinces, { method: "GET", url: "/api/v1/regions/provinces", bearer: adminSession.token });
    assert.equal(afterRes.status, 401);
    const session = await prisma.authSession.findUniqueOrThrow({ where: { id: adminSession.sessionId } });
    assert.equal(session.revokeReason, "ACCOUNT_DISABLED");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: school.id, action: "school.deactivate" } });
    assert.deepEqual(audit.after, { isActive: false, reason: "Kontrak berakhir", revokedSessions: 2 });

    const again = await deactivate(fx.sa.token, school.id, { reason: "Kontrak berakhir" });
    assert.equal(again.status, 409);
    assert.equal(again.body?.error?.code, "SCHOOL_ALREADY_INACTIVE");

    const back = await reactivate(fx.sa.token, school.id);
    assert.deepEqual(back.body?.data, { id: school.id, isActive: true });
    assert.equal((await reactivate(fx.sa.token, school.id)).body?.error?.code, "SCHOOL_ALREADY_ACTIVE");
    const stillRevoked = await callRoute(listProvinces, { method: "GET", url: "/api/v1/regions/provinces", bearer: adminSession.token });
    assert.equal(stillRevoked.status, 401);
    assert.ok(await prisma.auditLog.findFirst({ where: { entityId: school.id, action: "school.reactivate" } }));
  });

  test("alasan wajib 3..255 karakter; id asing 404; admin sekolah 403", async () => {
    assert.equal((await deactivate(fx.sa.token, fx.schoolB.id, {})).status, 400);
    assert.equal((await deactivate(fx.sa.token, fx.schoolB.id, { reason: "x" })).status, 400);
    assert.equal((await deactivate(fx.sa.token, "tidak-ada", { reason: "Uji alasan" })).status, 404);
    assert.equal((await reactivate(fx.sa.token, "tidak-ada")).status, 404);
    assert.equal((await deactivate(fx.adminA.token, fx.schoolA.id, { reason: "Uji alasan" })).status, 403);
    assert.equal((await reactivate(fx.adminB.token, fx.schoolB.id)).status, 403);
  });
});
