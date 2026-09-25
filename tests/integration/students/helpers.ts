/**
 * Helper integrasi domain siswa: dua sekolah lengkap (tahun ajaran + semester aktif + kelas), token
 * admin & super admin, body siswa lengkap, dan pemanggil route multipart (Content-Length wajib).
 */
import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import type { School, SchoolClass } from "@prisma/client";
import { createSessionToken } from "../helpers/auth";
import { prisma, uniq } from "../helpers/db";
import { createAcademicYearWithTerm, createClass, createSchool, createSchoolAdmin, createSuperAdmin, uniqNisn, type TestUser } from "../helpers/factories";
import type { AnyRouteHandler, Envelope, RouteResult } from "../helpers/request";

export interface SchoolFixture {
  readonly school: School;
  readonly academicYearId: string;
  readonly klass: SchoolClass;
  readonly admin: TestUser;
  readonly adminToken: string;
}

export async function createSchoolFixture(): Promise<SchoolFixture> {
  const school = await createSchool();
  const { academicYear } = await createAcademicYearWithTerm(school.id);
  const klass = await createClass(school.id, academicYear.id, { name: uniq("VII") });
  const admin = await createSchoolAdmin(school.id);
  const { token } = await createSessionToken(admin.id, { platform: "WEB", deviceId: null });
  return { school, academicYearId: academicYear.id, klass, admin, adminToken: token };
}

export async function createSuperAdminToken(): Promise<{ user: TestUser; token: string }> {
  const user = await createSuperAdmin();
  const { token } = await createSessionToken(user.id, { platform: "WEB", deviceId: null });
  return { user, token };
}

/** Body POST /school/students yang lengkap untuk aktivasi. */
export function completeStudentBody(classId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    nisn: uniqNisn(),
    nis: uniq("N").slice(0, 20),
    name: "Budi Santoso",
    gender: "MALE",
    birthPlace: "Bandung",
    birthDate: "2012-05-17",
    address: "Jl. Merdeka No. 10, Bandung",
    guardianName: "Siti Aminah",
    guardianPhone: "0812-3456-7890",
    currentClassId: classId,
    sppAmount: 150000,
    ...overrides,
  };
}

export const studentUrl = (path: string, schoolId?: string): string =>
  `/api/v1/school/students${path}${schoolId ? `${path.includes("?") ? "&" : "?"}schoolId=${encodeURIComponent(schoolId)}` : ""}`;

/** Panggil route multipart dengan Content-Length yang benar (pipeline mewajibkannya). */
export async function callMultipart<T = Envelope>(
  handler: AnyRouteHandler,
  options: { url: string; form: FormData; bearer?: string; headers?: Readonly<Record<string, string>> },
): Promise<RouteResult<T>> {
  const encoded = new Request("http://localhost/encode", { method: "POST", body: options.form });
  const body = new Uint8Array(await encoded.arrayBuffer());
  const headers = new Headers({ "content-type": encoded.headers.get("content-type") ?? "", "content-length": String(body.byteLength) });
  if (options.bearer) headers.set("authorization", `Bearer ${options.bearer}`);
  for (const [key, value] of Object.entries(options.headers ?? {})) headers.set(key, value);
  const request = new NextRequest(new URL(options.url, "http://localhost"), { method: "POST", headers, body });
  const response = await handler(request, { params: Promise.resolve({}) as Promise<never> });
  const text = response.headers.get("content-type")?.includes("json") ? await response.text() : "";
  return { status: response.status, headers: response.headers, body: text ? (JSON.parse(text) as T) : null, response };
}

export function importForm(file: Blob, fileName: string, fields: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set("file", file, fileName);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

export const IMPORT_HEADER = ["NISN", "NIS", "Nama Lengkap", "Jenis Kelamin", "Tempat Lahir", "Tanggal Lahir", "Alamat", "Nama Wali", "No HP Wali", "Kelas", "SPP"];

/** Satu baris data impor lengkap (string, cocok untuk CSV maupun XLSX). */
export function importRow(className: string, overrides: Partial<Record<number, string>> = {}): string[] {
  const base = [uniqNisn(), uniq("I").slice(0, 20), "Ani Lestari", "P", "Bandung", "17/05/2012", "Jl. Mawar No. 5, Bandung", "Wali Ani", "081298765432", className, "150000"];
  return base.map((value, i) => overrides[i] ?? value);
}

export async function xlsxBlob(rows: readonly (readonly unknown[])[]): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Siswa");
  rows.forEach((row) => sheet.addRow([...row]));
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function csvBlob(rows: readonly (readonly string[])[], delimiter = ","): Blob {
  const quote = (v: string) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return new Blob([`﻿${rows.map((r) => r.map(quote).join(delimiter)).join("\r\n")}\r\n`], { type: "text/csv" });
}

export async function countSchoolStudents(schoolId: string): Promise<{ students: number; users: number; audits: number }> {
  const [students, users, audits] = await Promise.all([
    prisma.student.count({ where: { schoolId } }),
    prisma.user.count({ where: { schoolId, role: "STUDENT" } }),
    prisma.auditLog.count({ where: { schoolId } }),
  ]);
  return { students, users, audits };
}
