/**
 * Analitik SPP per lingkup (2026-10-07): kategori lunas tepat waktu / telat / menunggak / belum jatuh tempo, rincian
 * satu tingkat di bawah lingkup, daftar siswa menunggak, dan cakupan per peran (super admin, Admin Pemda, admin sekolah).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { School } from "@prisma/client";
import { GET as analyticsRoute } from "@/app/api/v1/analytics/spp/route";
import { addDays, instantAtLocal, toDbDate, wibDate } from "@/lib/time/zone";
import { superFx, webToken } from "../ads/fixtures";
import { disconnect, prisma, uniq } from "../helpers/db";
import { createSchool, createSchoolAdmin, createStudent, uniqEmail } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";

interface Bucket { count: number; amount: number }
interface Analytics {
  scope: { level: string; label: string; childLevel: string };
  totals: { onTime: Bucket; late: Bucket; overdue: Bucket; notDue: Bucket; billed: number; paid: number; invoices: number; students: number; overdueStudents: number; lateStudents: number; collectionRate: number | null };
  trend: { period: string; overdue: Bucket }[];
  breakdown: { key: string; label: string; overdue: Bucket }[];
  students: { name: string; overdueInvoices: number; outstanding: number; lateInvoices: number; schoolName: string }[];
}

const today = wibDate(new Date());
const [year, month] = today.split("-").map(Number) as [number, number];
let superToken = "";
let depok: School;
let bandung: School;

async function invoice(school: School, name: string, inv: { due: string; status: "PAID" | "UNPAID" | "PARTIAL" | "VOID"; paidOn?: string; paidAmount?: number }) {
  const { student } = await createStudent(school.id, { name });
  const amount = 250_000;
  const paidAmount = inv.status === "PAID" ? amount : (inv.paidAmount ?? 0);
  await prisma.invoice.create({
    data: {
      schoolId: school.id, studentId: student.id, invoiceNo: uniq("A").slice(0, 20), periodYear: year, periodMonth: month, title: "SPP Uji",
      amount, paidAmount, status: inv.status, dueDate: toDbDate(inv.due), paidAt: inv.paidOn ? instantAtLocal(inv.paidOn, 600, "WIB") : null,
      ...(inv.status === "VOID" ? { voidedAt: new Date(), voidReason: "uji" } : {}),
    },
  });
}

before(async () => {
  superToken = (await superFx()).token;
  depok = await createSchool({ provinceCode: "32", cityCode: "32.76", data: { name: `SMP Depok ${uniq("d")}` } });
  bandung = await createSchool({ provinceCode: "32", cityCode: "32.73", data: { name: `SMP Bandung ${uniq("b")}` } });
  const due = addDays(today, -10);
  await invoice(depok, "Siswa Tepat", { due, status: "PAID", paidOn: addDays(due, -2) });
  await invoice(depok, "Siswa Telat", { due, status: "PAID", paidOn: addDays(due, 3) });
  await invoice(depok, "Siswa Nunggak", { due, status: "PARTIAL", paidAmount: 50_000 });
  await invoice(depok, "Siswa Belum", { due: addDays(today, 10), status: "UNPAID" });
  await invoice(depok, "Siswa Batal", { due, status: "VOID" });
  await invoice(bandung, "Siswa Bandung", { due, status: "UNPAID" });
});
after(disconnect);

const get = (token: string, query: string) => callRoute<Envelope<Analytics>>(analyticsRoute, { method: "GET", url: `/api/v1/analytics/spp?${query}`, bearer: token });

async function regionToken(regionProvinceCode: string, regionCityCode: string | null): Promise<string> {
  const user = await prisma.user.create({ data: { role: "REGION_ADMIN", name: "Pemda Uji", email: uniqEmail("pd"), passwordHash: "x", regionProvinceCode, regionCityCode } });
  return webToken(user.id);
}

test("lingkup sekolah: tepat waktu, telat, menunggak (sisa), belum jatuh tempo; VOID diabaikan; daftar siswa", async () => {
  const res = await get(superToken, `scope=school&schoolId=${depok.id}&months=3`);
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  const { totals, scope, students, breakdown, trend } = res.body!.data;
  assert.deepEqual([scope.level, scope.label, scope.childLevel], ["school", depok.name, "class"]);
  assert.deepEqual([totals.onTime.count, totals.late.count, totals.overdue.count, totals.notDue.count, totals.invoices], [1, 1, 1, 1, 4]);
  assert.deepEqual([totals.overdue.amount, totals.notDue.amount, totals.billed, totals.paid], [200_000, 250_000, 1_000_000, 550_000]);
  assert.deepEqual([totals.students, totals.overdueStudents, totals.lateStudents, totals.collectionRate], [4, 1, 1, 55]);
  assert.deepEqual(students.map(s => [s.name, s.overdueInvoices, s.outstanding, s.lateInvoices]), [["Siswa Nunggak", 1, 200_000, 0], ["Siswa Telat", 0, 0, 1]]);
  assert.equal(breakdown[0]?.label, "Tanpa kelas");
  assert.equal(trend.length, 3);
  assert.equal(trend.at(-1)?.overdue.count, 1);
});

test("Admin Pemda: keseluruhan = wilayahnya; kota lain/sekolah luar wilayah 404", async () => {
  const kotaDepok = await regionToken("32", "32.76");
  const all = await get(kotaDepok, "scope=all");
  assert.equal(all.status, 200);
  assert.deepEqual([all.body?.data.scope.level, all.body?.data.scope.label, all.body?.data.scope.childLevel], ["city", "Kota Depok, Jawa Barat", "school"]);
  assert.ok(all.body?.data.breakdown.some(b => b.key === depok.id) && !all.body?.data.breakdown.some(b => b.key === bandung.id));
  assert.equal((await get(kotaDepok, `scope=school&schoolId=${bandung.id}`)).body?.error?.code, "SCHOOL_NOT_FOUND");
  assert.equal((await get(kotaDepok, "scope=city&cityCode=32.73")).body?.error?.code, "REGION_NOT_FOUND");
  const jabar = await regionToken("32", null);
  const province = await get(jabar, "scope=all");
  assert.deepEqual([province.body?.data.scope.level, province.body?.data.scope.childLevel], ["province", "city"]);
  assert.ok(province.body?.data.breakdown.some(b => b.key === "32.76") && province.body?.data.breakdown.some(b => b.key === "32.73"));
  assert.equal((await get(jabar, "scope=province&provinceCode=31")).status, 404);
});

test("admin sekolah: selalu sekolahnya; sekolah lain 403; super admin keseluruhan per provinsi", async () => {
  const admin = await webToken((await createSchoolAdmin(depok.id)).id);
  const own = await get(admin, "scope=all");
  assert.deepEqual([own.status, own.body?.data.scope.level, own.body?.data.totals.invoices], [200, "school", 4]);
  assert.equal((await get(admin, `scope=school&schoolId=${bandung.id}`)).body?.error?.code, "SCOPE_MISMATCH");
  const all = await get(superToken, "scope=all&months=12");
  assert.deepEqual([all.status, all.body?.data.scope.label, all.body?.data.scope.childLevel], [200, "Seluruh Indonesia", "province"]);
  assert.ok(all.body?.data.breakdown.some(b => b.key === "32" && b.label === "Jawa Barat"));
  assert.equal((await get(superToken, "scope=city")).body?.error?.code, "CITY_REQUIRED");
});
