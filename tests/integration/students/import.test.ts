import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { GET as template } from "@/app/api/v1/school/students/import/template/route";
import { POST as importRoute } from "@/app/api/v1/school/students/import/route";
import { GET as list } from "@/app/api/v1/school/students/route";
import { verifyPassword } from "@/lib/auth/password";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma } from "../helpers/db";
import { createStudent } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import {
  IMPORT_HEADER,
  callMultipart,
  countSchoolStudents,
  createSchoolFixture,
  csvBlob,
  importForm,
  importRow,
  xlsxBlob,
  type SchoolFixture,
} from "./helpers";

type Report = { totalRows: number; validRows: number; errorRows: number; warningRows: number; rows: Array<{ row: number; nisn: string | null; errors: string[]; warnings: string[] }> };
type ImportBody = Envelope<{ dryRun: boolean; report: Report; created?: number; credentials?: Array<{ row: number; nisn: string; nis: string; name: string; className: string | null; temporaryPassword: string }> }>;

let a: SchoolFixture;
let b: SchoolFixture;
const url = "/api/v1/school/students/import";

before(async () => {
  [a, b] = await Promise.all([createSchoolFixture(), createSchoolFixture()]);
});
beforeEach(() => resetAllLimiters());
after(disconnect);

const send = (file: Blob, name: string, fields: Record<string, string> = {}, token = a.adminToken) =>
  callMultipart<ImportBody>(importRoute, { url, form: importForm(file, name, fields), bearer: token });

describe("templat impor", () => {
  test("XLSX lampiran dengan header & sheet Kelas berisi kelas aktif", async () => {
    const res = await callRoute(template, { method: "GET", url: `${url}/template`, bearer: a.adminToken });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /spreadsheetml/);
    assert.match(res.headers.get("content-disposition") ?? "", /attachment; filename="templat-impor-siswa\.xlsx"/);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await res.response.arrayBuffer());
    const header = (workbook.getWorksheet("Siswa")?.getRow(1).values as unknown[]).slice(1);
    assert.deepEqual(header, IMPORT_HEADER);
    const classes: unknown[] = [];
    workbook.getWorksheet("Kelas")?.eachRow((row, n) => n > 1 && classes.push(row.getCell(1).value));
    assert.deepEqual(classes, [a.klass.name]);
  });
});

describe("dry-run & commit", () => {
  test("dry-run XLSX melaporkan tanpa menulis apa pun", async () => {
    const before = await countSchoolStudents(a.school.id);
    const res = await send(await xlsxBlob([IMPORT_HEADER, importRow(a.klass.name), importRow(a.klass.name)]), "siswa.xlsx");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body?.data.dryRun, true);
    assert.equal(res.body?.data.report.totalRows, 2);
    assert.equal(res.body?.data.report.validRows, 2);
    assert.equal(res.body?.data.credentials, undefined);
    assert.deepEqual(await countSchoolStudents(a.school.id), before);
  });

  test("CSV (pemisah ;) dan XLSX memberi laporan yang sama", async () => {
    const rows = [IMPORT_HEADER, importRow(a.klass.name), importRow(a.klass.name, { 3: "X" })];
    const fromCsv = await send(csvBlob(rows, ";"), "siswa.csv");
    const fromXlsx = await send(await xlsxBlob(rows), "siswa.xlsx");
    assert.equal(fromCsv.status, 200, JSON.stringify(fromCsv.body));
    assert.deepEqual(fromCsv.body?.data.report, fromXlsx.body?.data.report);
    assert.equal(fromCsv.body?.data.report.errorRows, 1);
  });

  test("commit membuat N siswa AKTIF yang dapat dicari, kata sandi sekali tampil, audit dengan sha256", async () => {
    const rows = [importRow(a.klass.name), importRow(a.klass.name, { 2: "Candra Wijaya", 3: "L" }), importRow(a.klass.name)];
    const res = await send(await xlsxBlob([IMPORT_HEADER, ...rows]), "siswa.xlsx", { dryRun: "false" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body?.data.created, 3);
    const credentials = res.body?.data.credentials ?? [];
    assert.equal(credentials.length, 3);
    assert.deepEqual(credentials.map((c) => c.row), [2, 3, 4]);
    assert.equal(credentials[0]?.className, a.klass.name);
    for (const cred of credentials) {
      const found = await callRoute<{ data: Array<{ nisn: string; status: string }> }>(list, { method: "GET", url: `/api/v1/school/students?q=${cred.nisn}`, bearer: a.adminToken });
      assert.equal(found.body?.data[0]?.nisn, cred.nisn);
      assert.equal(found.body?.data[0]?.status, "ACTIVE");
      const student = await prisma.student.findFirst({ where: { schoolId: a.school.id, nisn: cred.nisn }, include: { user: { omit: { passwordHash: false } } } });
      assert.equal(student?.activeNisn, cred.nisn);
      assert.equal(student?.guardianPhone, "+6281298765432");
      assert.equal(student?.user.mustChangePassword, true);
      assert.ok(student?.user.tempPasswordExpiresAt);
      assert.equal(await verifyPassword(cred.temporaryPassword, student?.user.passwordHash ?? null), true);
    }
    const audit = await prisma.auditLog.findFirst({ where: { action: "student.import", schoolId: a.school.id }, orderBy: { createdAt: "desc" } });
    assert.match(JSON.stringify(audit?.after), /"fileSha256":"[0-9a-f]{64}"/);
    assert.doesNotMatch(JSON.stringify(audit), new RegExp(credentials[0]?.temporaryPassword ?? "x"));
  });

  test("satu baris salah -> commit 422 IMPORT_INVALID + laporan, NOL baris tertulis", async () => {
    const before = await countSchoolStudents(a.school.id);
    const rows = [IMPORT_HEADER, importRow(a.klass.name), importRow(a.klass.name, { 5: "31/02/2012" }), importRow(a.klass.name)];
    const res = await send(csvBlob(rows), "siswa.csv", { dryRun: "false" });
    assert.equal(res.status, 422);
    assert.equal(res.body?.error?.code, "IMPORT_INVALID");
    const report = (res.body?.error?.details as { report: Report }).report;
    assert.equal(report.errorRows, 1);
    assert.equal(report.rows[1]?.row, 3);
    assert.deepEqual(await countSchoolStudents(a.school.id), before);
  });

  test("commit memvalidasi ulang: NISN yang dibuat setelah dry-run -> 422, tidak ada yang tertulis", async () => {
    const rows = [IMPORT_HEADER, importRow(a.klass.name), importRow(a.klass.name)];
    const file = csvBlob(rows);
    assert.equal((await send(file, "siswa.csv")).body?.data.report.validRows, 2);
    await createStudent(a.school.id, { nisn: rows[2]?.[0] });
    const before = await countSchoolStudents(a.school.id);
    const res = await send(file, "siswa.csv", { dryRun: "false" });
    assert.equal(res.status, 422);
    assert.match(JSON.stringify(res.body?.error?.details), /NISN sudah terdaftar/);
    assert.deepEqual(await countSchoolStudents(a.school.id), before);
  });

  test("activate=false: header wajib longgar, siswa dibuat DRAFT tanpa activeNisn", async () => {
    const rows = [["NISN", "NIS", "Nama", "JK"], importRow(a.klass.name).slice(0, 4)];
    const res = await send(csvBlob(rows), "draf.csv", { dryRun: "false", activate: "false" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const student = await prisma.student.findFirst({ where: { schoolId: a.school.id, nisn: rows[1]?.[0] }, include: { user: true } });
    assert.equal(student?.status, "DRAFT");
    assert.equal(student?.activeNisn, null);
    assert.equal(student?.user.isActive, false);
  });

  test("pemegang NISN LULUS di sekolah lain: dry-run peringatan, commit melepas + notifikasi sekolah asal", async () => {
    const holder = await createStudent(b.school.id, { status: "GRADUATED" });
    const rows = [IMPORT_HEADER, importRow(a.klass.name, { 0: holder.student.nisn })];
    const dry = await send(csvBlob(rows), "siswa.csv", { confirmReleaseGraduatedNisn: "true" });
    assert.match(dry.body?.data.report.rows[0]?.warnings.join(" ") ?? "", /akun lama akan dilepas/);
    assert.equal(dry.body?.data.report.validRows, 1);
    const res = await send(csvBlob(rows), "siswa.csv", { dryRun: "false", confirmReleaseGraduatedNisn: "true" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const released = await prisma.student.findFirst({ where: { id: holder.student.id, schoolId: b.school.id } });
    assert.equal(released?.activeNisn, null);
    assert.ok(await prisma.auditLog.findFirst({ where: { action: "student.nisn_release", entityId: holder.student.id, schoolId: b.school.id } }));
    assert.ok(await prisma.notification.findFirst({ where: { userId: b.admin.id, type: "NISN_RELEASED" } }));
  });

  test("NISN AKTIF di sekolah lain -> error baris", async () => {
    const holder = await createStudent(b.school.id);
    const res = await send(csvBlob([IMPORT_HEADER, importRow(a.klass.name, { 0: holder.student.nisn })]), "siswa.csv");
    assert.match(res.body?.data.report.rows[0]?.errors.join(" ") ?? "", /aktif di sekolah lain/);
  });
});

describe("penolakan berkas", () => {
  test("header wajib hilang -> 422 IMPORT_HEADERS_MISSING", async () => {
    const res = await send(csvBlob([["NISN", "NIS", "Nama", "JK"], ["0012345678", "A1", "Ani Lestari", "P"]]), "siswa.csv");
    assert.equal(res.status, 422);
    assert.equal(res.body?.error?.code, "IMPORT_HEADERS_MISSING");
    assert.match(res.body?.error?.message ?? "", /Tempat Lahir/);
  });

  test("zip-bomb (entri mengembang > 8 MiB) -> 422 IMPORT_FILE_INVALID", async () => {
    const res = await send(new Blob([new Uint8Array(zipBomb())]), "bom.xlsx");
    assert.equal(res.status, 422);
    assert.equal(res.body?.error?.code, "IMPORT_FILE_INVALID");
  });

  test("berkas > 2 MiB -> 413", async () => {
    const big = new Blob([new Uint8Array(2 * 1024 * 1024 + 10).fill(65)]);
    const res = await send(big, "besar.csv");
    assert.equal(res.status, 413);
  });

  test("> 1.000 baris data -> 422 IMPORT_TOO_MANY_ROWS", async () => {
    const rows = [IMPORT_HEADER, ...Array.from({ length: 1001 }, () => importRow(a.klass.name))];
    const res = await send(csvBlob(rows), "banyak.csv");
    assert.equal(res.status, 422);
    assert.equal(res.body?.error?.code, "IMPORT_TOO_MANY_ROWS");
  });

  test("berkas biner bukan XLSX/CSV -> 422; tanpa berkas -> 400", async () => {
    const res = await send(new Blob([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 1])]), "lama.xls");
    assert.equal(res.status, 422);
    assert.equal(res.body?.error?.code, "IMPORT_FILE_INVALID");
    const form = new FormData();
    form.set("dryRun", "true");
    const missing = await callMultipart(importRoute, { url, form, bearer: a.adminToken });
    assert.equal(missing.status, 400);
  });

  test("peran siswa -> 403; rate limit IMPORT per pengguna -> 429", async () => {
    const { user } = await createStudent(a.school.id);
    const { token } = await createSessionToken(user.id);
    assert.equal((await send(csvBlob([IMPORT_HEADER]), "x.csv", {}, token)).status, 403);
    const file = csvBlob([IMPORT_HEADER, importRow(a.klass.name)]);
    for (let i = 0; i < 10; i += 1) assert.equal((await send(file, "x.csv")).status, 200);
    const limited = await send(file, "x.csv");
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get("retry-after"));
  });
});

/** XLSX palsu: satu entri deflate 26 MiB nol (~26 KiB terkompresi) dengan ukuran header yang berbohong. */
function zipBomb(): Buffer {
  const payload = deflateRawSync(Buffer.alloc(26 * 1024 * 1024));
  const name = Buffer.from("xl/worksheets/sheet1.xml");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(1000, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(1000, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + name.length + payload.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + name.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, name, payload, central, name, eocd]);
}
