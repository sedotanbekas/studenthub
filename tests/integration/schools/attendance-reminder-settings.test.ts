/**
 * Pengaturan pengingat absen (N5): GET/PUT /school/settings/attendance-reminder — bawaan, simpan + audit, nilai sama
 * tanpa audit, validasi, cakupan sekolah, dan jangkauan notifikasi HP.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { GET as getRoute, PUT as putRoute } from "@/app/api/v1/school/settings/attendance-reminder/route";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { disconnect, prisma } from "../helpers/db";
import { createSchool, createSchoolAdmin, createStudent } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { addDevice } from "../push/helpers";
import { actor, setupTwoSchools, type TwoSchools } from "./fixtures";

interface Settings {
  enabled: boolean; leadMinutes: number; checkInOpenMinute: number; startMinute: number; lateToleranceMinutes: number; schoolDaysMask: number;
  sendMinute: number; timezone: string; defaultSchedule: boolean; activeStudentCount: number; pushReadyStudentCount: number;
}

let fx: TwoSchools;
before(async () => {
  resetAllLimiters();
  fx = await setupTwoSchools();
});
after(disconnect);

const PATH = "/api/v1/school/settings/attendance-reminder";
const read = (token: string, query = "") => callRoute<Envelope<Settings>>(getRoute, { method: "GET", url: `${PATH}${query}`, bearer: token });
const save = (token: string, json: unknown, query = "") => callRoute<Envelope<Settings>>(putRoute, { method: "PUT", url: `${PATH}${query}`, bearer: token, json });
const audits = (schoolId: string) => prisma.auditLog.count({ where: { entityId: schoolId, action: "school.attendance_reminder_update" } });

test("bawaan: menyala 15 menit (06:45), jadwal masih bawaan, jangkauan = siswa aktif yang punya perangkat", async () => {
  const school = await createSchool();
  const admin = await actor(await createSchoolAdmin(school.id));
  const [withDevice] = [await createStudent(school.id), await createStudent(school.id)];
  await addDevice(withDevice!.user.id);
  const res = await read(admin.token);
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  assert.deepEqual(res.body?.data, {
    enabled: true, leadMinutes: 15, checkInOpenMinute: 360, startMinute: 420, lateToleranceMinutes: 15, schoolDaysMask: 31,
    sendMinute: 405, timezone: "WIB", defaultSchedule: true, activeStudentCount: 2, pushReadyStudentCount: 1,
  });
});

test("PUT menyimpan + audit; nilai sama tanpa audit; lead dijepit ke jam buka pada sendMinute", async () => {
  const before = await audits(fx.schoolA.id);
  const res = await save(fx.adminA.token, { enabled: true, leadMinutes: 120 });
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  assert.deepEqual([res.body?.data.leadMinutes, res.body?.data.sendMinute], [120, 360]);
  assert.equal(await audits(fx.schoolA.id), before + 1);
  assert.equal((await save(fx.adminA.token, { enabled: true, leadMinutes: 120 })).status, 200);
  assert.equal(await audits(fx.schoolA.id), before + 1, "nilai sama -> tanpa audit");
  assert.equal((await save(fx.adminA.token, { enabled: false, leadMinutes: 120 })).body?.data.enabled, false);
  const row = await prisma.school.findUniqueOrThrow({ where: { id: fx.schoolA.id }, select: { attendanceReminderEnabled: true, attendanceReminderLeadMinutes: true } });
  assert.deepEqual(row, { attendanceReminderEnabled: false, attendanceReminderLeadMinutes: 120 });
});

test("validasi: 4 / 121 / kunci hilang / kunci asing -> 400", async () => {
  for (const body of [{ enabled: true, leadMinutes: 4 }, { enabled: true, leadMinutes: 121 }, { enabled: true }, { enabled: true, leadMinutes: 15, extra: 1 }, { enabled: "ya", leadMinutes: 15 }]) {
    const res = await save(fx.adminA.token, body);
    assert.deepEqual([res.status, res.body?.error?.code], [400, "VALIDATION_FAILED"], JSON.stringify(body));
  }
});

test("cakupan: super admin wajib ?schoolId (400), sekolah tak dikenal 404; admin sekolah lain 403; siswa & sponsor 403", async () => {
  assert.equal((await read(fx.sa.token)).body?.error?.code, "SCHOOL_ID_REQUIRED");
  assert.equal((await read(fx.sa.token, "?schoolId=tidak-ada")).status, 404);
  assert.equal((await read(fx.sa.token, `?schoolId=${fx.schoolB.id}`)).status, 200);
  assert.equal((await save(fx.adminA.token, { enabled: true, leadMinutes: 20 }, `?schoolId=${fx.schoolB.id}`)).body?.error?.code, "SCOPE_MISMATCH");
  assert.equal((await read(fx.student.token)).status, 403);
  assert.equal((await read(fx.sponsor.token)).status, 403);
});
