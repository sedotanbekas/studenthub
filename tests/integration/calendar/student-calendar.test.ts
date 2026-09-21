import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { GET as calendarRoute } from "@/app/api/v1/student/calendar/route";
import { localParts, toDbDate } from "@/lib/time/zone";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma } from "../helpers/db";
import { createAcademicYearWithTerm, createSchool, createSchoolAdmin, createStudent } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { webToken } from "../academics/helpers";

interface Day {
  date: string;
  isSchoolDay: boolean;
  reason: "SCHOOL_DAY" | "DAY_OFF" | "HOLIDAY" | "OUTSIDE_TERM";
  holidayName: string | null;
}
interface Calendar {
  month: string;
  schoolDayCount: number;
  days: Day[];
}

/**
 * September 2096 dimulai hari Sabtu: 20 hari kerja Senin-Jumat. Libur sekolah 10-11 (Sen-Sel),
 * libur nasional 17 (Sen), libur sekolah LAIN 20 (Kam, tidak berlaku). Semester 2096-07-16..2096-12-15.
 */
const URL_SEPT = "/api/v1/student/calendar?month=2096-09";
let nationalId = "";
let schoolId = "";
let studentToken = "";

before(async () => {
  const school = await createSchool();
  schoolId = school.id;
  const other = await createSchool();
  await createAcademicYearWithTerm(school.id, {
    name: "2096/2097", yearStart: "2096-07-16", yearEnd: "2097-06-29", termStart: "2096-07-16", termEnd: "2096-12-15",
  });
  await prisma.holiday.create({ data: { schoolId: school.id, name: "Libur Sekolah Uji", startDate: toDbDate("2096-09-10"), endDate: toDbDate("2096-09-11") } });
  await prisma.holiday.create({ data: { schoolId: other.id, name: "Libur Sekolah Lain", startDate: toDbDate("2096-09-20"), endDate: toDbDate("2096-09-20") } });
  nationalId = (await prisma.holiday.create({ data: { schoolId: null, name: "Libur Nasional Uji", startDate: toDbDate("2096-09-17"), endDate: toDbDate("2096-09-17") } })).id;
  const { user } = await createStudent(school.id);
  studentToken = (await createSessionToken(user.id)).token;
});
after(async () => {
  await prisma.holiday.deleteMany({ where: { id: nationalId } });
  await disconnect();
});

const get = (token: string, url = URL_SEPT) => callRoute<Envelope<Calendar>>(calendarRoute, { method: "GET", url, bearer: token });
const dayOf = (calendar: Calendar | undefined, date: string): Day | undefined => calendar?.days.find((d) => d.date === date);

test("kalender bulanan siswa: hari sekolah, akhir pekan, libur sekolah & nasional", async () => {
  const res = await get(studentToken);
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  const cal = res.body?.data;
  assert.equal(cal?.month, "2096-09");
  assert.equal(cal?.days.length, 30);
  assert.equal(cal?.schoolDayCount, 17);
  assert.deepEqual(dayOf(cal, "2096-09-03"), { date: "2096-09-03", isSchoolDay: true, reason: "SCHOOL_DAY", holidayName: null });
  assert.deepEqual(dayOf(cal, "2096-09-01"), { date: "2096-09-01", isSchoolDay: false, reason: "DAY_OFF", holidayName: null });
  assert.deepEqual(dayOf(cal, "2096-09-11"), { date: "2096-09-11", isSchoolDay: false, reason: "HOLIDAY", holidayName: "Libur Sekolah Uji" });
  assert.equal(dayOf(cal, "2096-09-17")?.holidayName, "Libur Nasional Uji");
  assert.equal(dayOf(cal, "2096-09-20")?.reason, "SCHOOL_DAY", "libur sekolah lain tidak berlaku");
});

test("di luar semester -> OUTSIDE_TERM; mask 63 membuat Sabtu hari sekolah", async () => {
  const dec = await get(studentToken, "/api/v1/student/calendar?month=2096-12");
  assert.equal(dayOf(dec.body?.data, "2096-12-14")?.reason, "SCHOOL_DAY");
  assert.equal(dayOf(dec.body?.data, "2096-12-17")?.reason, "OUTSIDE_TERM");
  await prisma.school.update({ where: { id: schoolId }, data: { schoolDaysMask: 63 } });
  try {
    const sept = await get(studentToken);
    assert.equal(dayOf(sept.body?.data, "2096-09-22")?.reason, "SCHOOL_DAY");
    assert.equal(sept.body?.data.schoolDayCount, 22);
  } finally {
    await prisma.school.update({ where: { id: schoolId }, data: { schoolDaysMask: 31 } });
  }
});

test("default bulan berjalan; format bulan salah -> 400", async () => {
  const res = await get(studentToken, "/api/v1/student/calendar");
  assert.equal(res.status, 200);
  assert.equal(res.body?.data.month, localParts(new Date(), "WIB").ymd.slice(0, 7));
  for (const month of ["2096-13", "2096-9", "sept"]) {
    assert.equal((await get(studentToken, `/api/v1/student/calendar?month=${month}`)).status, 400, month);
  }
});

test("siswa LULUS boleh; siswa NONAKTIF ditolak saat autentikasi (401); admin ditolak 403", async () => {
  const graduated = await createStudent(schoolId, { status: "GRADUATED" });
  assert.equal((await get((await createSessionToken(graduated.user.id)).token)).status, 200);
  const inactive = await createStudent(schoolId, { status: "INACTIVE" });
  const denied = await get((await createSessionToken(inactive.user.id)).token);
  assert.equal(denied.status, 401);
  assert.equal(denied.body?.error?.code, "ACCOUNT_INACTIVE");
  const admin = await createSchoolAdmin(schoolId);
  const forbidden = await get(await webToken(admin.id));
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body?.error?.code, "FORBIDDEN");
});

test("siswa sekolah lain melihat kalender sekolahnya sendiri (tanpa libur sekolah ini)", async () => {
  const otherSchool = await createSchool();
  await createAcademicYearWithTerm(otherSchool.id, {
    name: "2096/2097", yearStart: "2096-07-16", yearEnd: "2097-06-29", termStart: "2096-07-16", termEnd: "2096-12-15",
  });
  const { user } = await createStudent(otherSchool.id);
  const res = await get((await createSessionToken(user.id)).token);
  assert.equal(dayOf(res.body?.data, "2096-09-10")?.reason, "SCHOOL_DAY");
  assert.equal(dayOf(res.body?.data, "2096-09-17")?.reason, "HOLIDAY", "libur nasional berlaku untuk semua sekolah");
  assert.equal(res.body?.data.schoolDayCount, 19);
});
