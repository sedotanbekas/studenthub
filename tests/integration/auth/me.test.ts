import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { DEFAULT_THEME } from "@/lib/schools/theme-rules";
import { createSessionToken } from "../helpers/auth";
import { disconnect } from "../helpers/db";
import {
  createAcademicYearWithTerm,
  createClass,
  createSchool,
  createSchoolAdmin,
  createSponsor,
  createStudent,
  createSuperAdmin,
} from "../helpers/factories";
import { loginOk, me } from "./helpers";

let schoolId = "";
let schoolName = "";
let classId = "";
let className = "";

before(async () => {
  resetAllLimiters();
  const school = await createSchool({ timezone: "WITA" });
  schoolId = school.id;
  schoolName = school.name;
  const { academicYear } = await createAcademicYearWithTerm(school.id);
  const klass = await createClass(school.id, academicYear.id);
  classId = klass.id;
  className = klass.name;
});
after(disconnect);

test("tanpa token atau token rusak -> 401", async () => {
  assert.equal((await me("")).status, 401);
  assert.equal((await me("bukan.jwt.valid")).status, 401);
});

test("siswa: data sekolah, siswa (kelas), izin; tanpa sponsor", async () => {
  const { user, student } = await createStudent(schoolId, { classId });
  const tokens = await loginOk(student.nisn, { platform: "ANDROID" });
  const res = await me(tokens.accessToken);
  assert.equal(res.status, 200);
  const data = res.body?.data;
  assert.ok(data);
  assert.equal(data.user.id, user.id);
  assert.equal(data.user.email, null);
  assert.equal(data.user.role, "STUDENT");
  assert.ok(data.user.lastLoginAt);
  assert.deepEqual(data.school, {
    id: schoolId,
    name: schoolName,
    timezone: "WITA",
    theme: { preset: "nusantara", ...DEFAULT_THEME, isCustom: false, updatedAt: null },
  });
  assert.deepEqual(data.student, { id: student.id, nisn: student.nisn, nis: student.nis, status: "ACTIVE", className });
  assert.equal(data.sponsor, null);
  assert.ok(data.permissions.includes("auth.self"));
  assert.ok(!data.permissions.includes("platform.jobs.read"));
});

test("siswa LULUS tetap bisa membaca /auth/me (read-only)", async () => {
  const { user } = await createStudent(schoolId, { status: "GRADUATED" });
  const { token } = await createSessionToken(user.id);
  const res = await me(token);
  assert.equal(res.status, 200);
  assert.equal(res.body?.data.student?.status, "GRADUATED");
  assert.equal(res.body?.data.student?.className, null);
});

test("admin sekolah, sponsor, dan super admin", async () => {
  const admin = await createSchoolAdmin(schoolId);
  const adminMe = await me((await createSessionToken(admin.id, { platform: "WEB", deviceId: null })).token);
  assert.equal(adminMe.body?.data.school?.id, schoolId);
  assert.equal(adminMe.body?.data.school?.theme.isCustom, false);
  assert.equal(adminMe.body?.data.student, null);
  assert.ok(adminMe.body?.data.permissions.includes("region.read"));

  const { sponsor, user } = await createSponsor({ status: "PENDING" });
  const sponsorMe = await me((await createSessionToken(user.id, { platform: "WEB", deviceId: null })).token);
  assert.equal(sponsorMe.status, 200);
  assert.deepEqual(sponsorMe.body?.data.sponsor, { id: sponsor.id, companyName: sponsor.companyName, status: "PENDING" });
  assert.equal(sponsorMe.body?.data.school, null);

  const sa = await createSuperAdmin();
  const saMe = await me((await createSessionToken(sa.id, { platform: "WEB", deviceId: null })).token);
  assert.equal(saMe.body?.data.user.role, "SUPER_ADMIN");
  assert.equal(saMe.body?.data.user.email, sa.email);
  assert.ok(saMe.body?.data.permissions.includes("platform.jobs.read"));
});
