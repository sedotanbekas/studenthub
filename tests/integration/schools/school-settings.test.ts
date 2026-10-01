import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { GET as getProfile } from "@/app/api/v1/school/profile/route";
import { PATCH as patchSettings } from "@/app/api/v1/school/settings/route";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { localParts, toDbDate } from "@/lib/time/zone";
import { disconnect, prisma, uniq } from "../helpers/db";
import { createAcademicYearWithTerm, createClass, createSchool, createSchoolAdmin, createStudent } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { actor, setupTwoSchools, type TwoSchools } from "./fixtures";

type Profile = {
  id: string;
  name: string;
  startMinute: number;
  educationLevel: string | null;
  schedule: Record<string, string>;
  activeTerm: { label: string; academicYearName: string; startDate: string } | null;
  setupChecklist: { today: string; hasActiveTerm: boolean; hasTermToday: boolean; nextTermStartDate: string | null; classCount: number; subjectCount: number; activeStudentCount: number; holidayCount: number };
};
type ErrorDetails = { errors: Array<{ field: string; code: string }> };

let fx: TwoSchools;

before(async () => {
  resetAllLimiters();
  fx = await setupTwoSchools();
});
after(disconnect);

const profile = (token: string, query = "") =>
  callRoute<Envelope<Profile>>(getProfile, { method: "GET", url: `/api/v1/school/profile${query}`, bearer: token });
const settings = (token: string, json: unknown, query = "") =>
  callRoute<Envelope<Profile>>(patchSettings, { method: "PATCH", url: `/api/v1/school/settings${query}`, bearer: token, json });

describe("GET /school/profile", () => {
  test("admin sekolah: profil + semester aktif + checklist onboarding", async () => {
    const school = await createSchool();
    const admin = await actor(await createSchoolAdmin(school.id));
    const { academicYear } = await createAcademicYearWithTerm(school.id);
    const otherYear = await createAcademicYearWithTerm(school.id, { name: "2027/2028", active: false, yearStart: "2027-07-12", yearEnd: "2028-06-24", termStart: "2027-07-12", termEnd: "2027-12-18" });
    await createClass(school.id, academicYear.id);
    await createClass(school.id, academicYear.id, { isActive: false });
    await createClass(school.id, otherYear.academicYear.id);
    await prisma.subject.create({ data: { schoolId: school.id, code: uniq("M").slice(0, 20), name: "Matematika" } });
    await Promise.all([createStudent(school.id), createStudent(school.id, { status: "DRAFT" })]);
    await prisma.holiday.create({ data: { schoolId: school.id, name: "Libur Sekolah", startDate: toDbDate("2026-10-01"), endDate: toDbDate("2026-10-02") } });

    const res = await profile(admin.token);
    assert.equal(res.status, 200);
    assert.equal(res.body?.data.id, school.id);
    assert.equal(res.body?.data.schedule.start, "07:00");
    assert.deepEqual(res.body?.data.activeTerm && { label: res.body.data.activeTerm.label, startDate: res.body.data.activeTerm.startDate }, {
      label: "Semester Ganjil 2026/2027",
      startDate: "2026-07-13",
    });
    const { today, hasTermToday, nextTermStartDate, ...counts } = res.body!.data.setupChecklist;
    assert.deepEqual(counts, { hasActiveTerm: true, classCount: 1, subjectCount: 1, activeStudentCount: 1, holidayCount: 1 });
    // Semester uji: 2026-07-13..2026-12-19 (aktif) dan 2027-07-12..2027-12-18; nilai "hari ini" mengikuti jam nyata.
    assert.equal(today, localParts(new Date(), "WIB").ymd);
    assert.equal(hasTermToday, (today >= "2026-07-13" && today <= "2026-12-19") || (today >= "2027-07-12" && today <= "2027-12-18"));
    assert.equal(nextTermStartDate, today < "2026-07-13" ? "2026-07-13" : today < "2027-07-12" ? "2027-07-12" : null);
  });

  test("tanpa semester aktif: activeTerm null", async () => {
    const res = await profile(fx.adminB.token);
    assert.equal(res.status, 200);
    assert.equal(res.body?.data.activeTerm, null);
    assert.equal(res.body?.data.setupChecklist.hasActiveTerm, false);
  });

  test("scope: admin sekolah lain 403, super admin wajib schoolId, sekolah tak dikenal 404", async () => {
    const own = await profile(fx.adminA.token, `?schoolId=${fx.schoolA.id}`);
    assert.equal(own.status, 200);
    const mismatch = await profile(fx.adminA.token, `?schoolId=${fx.schoolB.id}`);
    assert.equal(mismatch.status, 403);
    assert.equal(mismatch.body?.error?.code, "SCOPE_MISMATCH");
    const noSchool = await profile(fx.sa.token);
    assert.equal(noSchool.status, 400);
    assert.equal(noSchool.body?.error?.code, "SCHOOL_ID_REQUIRED");
    const sa = await profile(fx.sa.token, `?schoolId=${fx.schoolB.id}`);
    assert.equal(sa.body?.data.id, fx.schoolB.id);
    assert.equal((await profile(fx.sa.token, "?schoolId=tidak-ada")).status, 404);
  });

  test("siswa & sponsor -> 403", async () => {
    assert.equal((await profile(fx.student.token)).status, 403);
    assert.equal((await profile(fx.sponsor.token)).status, 403);
  });
});

describe("PATCH /school/settings", () => {
  test("admin sekolah mengubah jadwal: tersimpan, label HH:mm, audit school.settings_update", async () => {
    const school = await createSchool();
    const admin = await actor(await createSchoolAdmin(school.id));
    const res = await settings(admin.token, { startMinute: 430, lateToleranceMinutes: 10, schoolDaysMask: 63 });
    assert.equal(res.status, 200);
    assert.equal(res.body?.data.startMinute, 430);
    assert.equal(res.body?.data.schedule.start, "07:10");
    assert.equal(res.body?.data.schedule.lateAfter, "07:20");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: school.id, action: "school.settings_update" } });
    assert.equal(audit.actorId, admin.user.id);
    assert.equal(audit.schoolId, school.id);
    assert.deepEqual(audit.before, { startMinute: 420, lateToleranceMinutes: 15, schoolDaysMask: 31 });
    assert.deepEqual(audit.after, { startMinute: 430, lateToleranceMinutes: 10, schoolDaysMask: 63 });
    const row = await prisma.school.findUniqueOrThrow({ where: { id: school.id } });
    assert.equal(row.geofenceUpdatedAt, null);
    assert.equal(row.bankChangedAt, null);
  });

  test("lokasi, geofence, zona waktu, rekening tidak bisa diubah admin sekolah -> 400", async () => {
    const forbiddenKeys: Array<Record<string, unknown>> = [
      { latitude: -6.2 },
      { longitude: 107 },
      { geofenceRadiusM: 1000 },
      { timezone: "WIT" },
      { bankName: "BCA", bankAccountNumber: "12345", bankAccountHolder: "X" },
      { name: "Nama Baru" },
    ];
    for (const body of forbiddenKeys) {
      const res = await settings(fx.adminA.token, { startMinute: 425, ...body });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body?.error?.code, "VALIDATION_FAILED");
    }
    const row = await prisma.school.findUniqueOrThrow({ where: { id: fx.schoolA.id } });
    assert.equal(row.startMinute, 420);
    assert.equal(row.latitude.toNumber(), -6.9147);
  });

  test("hasil merge tidak valid -> 422 SCHOOL_CONFIG_INVALID, data tetap", async () => {
    const res = await settings(fx.adminA.token, { checkInCloseMinute: 430 });
    assert.equal(res.status, 422);
    assert.equal(res.body?.error?.code, "SCHOOL_CONFIG_INVALID");
    assert.deepEqual((res.body?.error?.details as ErrorDetails).errors.map((e) => e.code), ["LATE_THRESHOLD_NOT_BEFORE_CLOSE"]);
    const mask = await settings(fx.adminA.token, { schoolDaysMask: 128 });
    assert.equal(mask.status, 422);
    const order = await settings(fx.adminA.token, { checkInOpenMinute: 500 });
    assert.equal(order.status, 422);
    assert.equal((await prisma.school.findUniqueOrThrow({ where: { id: fx.schoolA.id } })).checkInCloseMinute, 600);
  });

  test("body kosong / bukan bilangan bulat -> 400", async () => {
    assert.equal((await settings(fx.adminA.token, {})).status, 400);
    assert.equal((await settings(fx.adminA.token, { startMinute: 430.5 })).status, 400);
    assert.equal((await settings(fx.adminA.token, { startMinute: "07:10" })).status, 400);
  });

  test("scope: admin A ke sekolah B 403; super admin wajib schoolId; sekolah tak dikenal 404", async () => {
    const mismatch = await settings(fx.adminA.token, { startMinute: 425 }, `?schoolId=${fx.schoolB.id}`);
    assert.equal(mismatch.status, 403);
    assert.equal(mismatch.body?.error?.code, "SCOPE_MISMATCH");
    assert.equal((await prisma.school.findUniqueOrThrow({ where: { id: fx.schoolB.id } })).startMinute, 420);
    const noSchool = await settings(fx.sa.token, { startMinute: 425 });
    assert.equal(noSchool.body?.error?.code, "SCHOOL_ID_REQUIRED");
    assert.equal((await settings(fx.sa.token, { startMinute: 425 }, "?schoolId=tidak-ada")).status, 404);
    const school = await createSchool();
    const sa = await settings(fx.sa.token, { dayEndMinute: 960 }, `?schoolId=${school.id}`);
    assert.equal(sa.status, 200);
    assert.equal((await prisma.school.findUniqueOrThrow({ where: { id: school.id } })).dayEndMinute, 960);
  });

  test("siswa & sponsor -> 403", async () => {
    assert.equal((await settings(fx.student.token, { startMinute: 425 })).status, 403);
    assert.equal((await settings(fx.sponsor.token, { startMinute: 425 })).status, 403);
  });
});

describe("jenjang sekolah lewat PATCH /school/settings", () => {
  test("admin sekolah mengisi jenjang yang kosong SEKALI; menggantinya ditolak, super admin tetap boleh", async () => {
    const school = await createSchool();
    const admin = await actor(await createSchoolAdmin(school.id));
    assert.equal((await profile(admin.token)).body?.data.educationLevel, null);

    const first = await settings(admin.token, { educationLevel: "SMK" });
    assert.equal(first.status, 200);
    assert.equal(first.body?.data.educationLevel, "SMK");
    assert.equal((await settings(admin.token, { educationLevel: "SMK" })).status, 200, "nilai sama = tidak berubah");

    const locked = await settings(admin.token, { educationLevel: "SMA" });
    assert.equal(locked.status, 409);
    assert.equal(locked.body?.error?.code, "EDUCATION_LEVEL_LOCKED");

    const bySa = await settings(fx.sa.token, { educationLevel: "SMA" }, `?schoolId=${school.id}`);
    assert.equal(bySa.status, 200);
    assert.equal(bySa.body?.data.educationLevel, "SMA");
    const audit = await prisma.auditLog.findFirst({ where: { schoolId: school.id, action: "school.settings_update" }, orderBy: { createdAt: "desc" } });
    assert.deepEqual(audit?.after, { educationLevel: "SMA" });
  });

  test("jenjang tidak dikenal -> 400", async () => {
    const school = await createSchool();
    const admin = await actor(await createSchoolAdmin(school.id));
    assert.equal((await settings(admin.token, { educationLevel: "SLB" })).status, 400);
  });
});
