/**
 * Fixture integrasi SPP: sekolah (rekening diisi) + admin bertoken + kelas, siswa bertoken, periode relatif
 * bulan ini (WIB, sama dengan jam route), foto bukti uji berpola acak (dHash unik per seed), dan pemanggil
 * route SPP. DB test dipakai ulang tanpa reset -> semua data unik per pemanggilan.
 */
import { NextRequest } from "next/server";
import sharp from "sharp";
import type { School, SchoolClass } from "@prisma/client";
import { POST as createInvoiceRoute } from "@/app/api/v1/school/invoices/route";
import { POST as submitRoute } from "@/app/api/v1/student/invoices/[id]/submissions/route";
import { localParts, type LocalDate } from "@/lib/time/zone";
import { createSessionToken } from "../helpers/auth";
import { uniq } from "../helpers/db";
import {
  createAcademicYearWithTerm,
  createClass,
  createSchool,
  createSchoolAdmin,
  createStudent,
  createSuperAdmin,
  type CreateStudentOptions,
  type TestStudent,
  type TestUser,
} from "../helpers/factories";
import { callRoute, type AnyRouteHandler, type Envelope } from "../helpers/request";

export interface BillingFixture {
  readonly school: School;
  readonly klass: SchoolClass;
  readonly admin: TestUser;
  readonly adminToken: string;
}

export interface StudentWithToken extends TestStudent {
  readonly token: string;
}

export const todayWib = (): LocalDate => localParts(new Date(), "WIB").ymd;

/** Periode (tahun, bulan) relatif bulan ini WIB. */
export function periodAt(offsetMonths: number): { periodYear: number; periodMonth: number } {
  const { year, month } = localParts(new Date(), "WIB");
  const key = year * 12 + (month - 1) + offsetMonths;
  return { periodYear: Math.floor(key / 12), periodMonth: (key % 12) + 1 };
}

export async function webToken(userId: string): Promise<string> {
  return (await createSessionToken(userId, { platform: "WEB", deviceId: null })).token;
}

export async function createBillingSchool(options: { timezone?: "WIB" | "WITA" | "WIT"; bankChangedAt?: Date | null } = {}): Promise<BillingFixture> {
  const school = await createSchool({
    timezone: options.timezone ?? "WIB",
    data: {
      bankName: "Bank Uji", bankAccountNumber: "1234567890", bankAccountHolder: "Yayasan Uji",
      bankChangedAt: options.bankChangedAt === undefined ? new Date(Date.now() - 60 * 86_400_000) : options.bankChangedAt,
    },
  });
  const { academicYear } = await createAcademicYearWithTerm(school.id);
  const klass = await createClass(school.id, academicYear.id, { name: uniq("VII") });
  const admin = await createSchoolAdmin(school.id);
  return { school, klass, admin, adminToken: await webToken(admin.id) };
}

export async function createStudentWithToken(fx: BillingFixture, options: CreateStudentOptions = {}): Promise<StudentWithToken> {
  const created = await createStudent(fx.school.id, { classId: fx.klass.id, ...options });
  return { ...created, token: (await createSessionToken(created.user.id)).token };
}

export async function superAdminToken(): Promise<string> {
  return webToken((await createSuperAdmin()).id);
}

export const schoolUrl = (path: string, schoolId?: string): string =>
  `/api/v1/school${path}${schoolId ? `${path.includes("?") ? "&" : "?"}schoolId=${encodeURIComponent(schoolId)}` : ""}`;

export interface InvoiceBody {
  readonly id: string;
  readonly invoiceNo: string;
  readonly status: string;
  readonly displayStatus: string;
  readonly amount: number;
  readonly paidAmount: number;
  readonly remaining: number;
  readonly dueDate: string;
  readonly isOverdue: boolean;
  readonly pendingSubmissionId: string | null;
  readonly paidAt: string | null;
  readonly title: string;
}

/** Terbitkan satu tagihan lewat route admin; gagal eksplisit bila bukan 201. */
export async function issueInvoice(fx: BillingFixture, studentId: string, offsetMonths = 0, amount = 150_000, extra: Record<string, unknown> = {}): Promise<InvoiceBody> {
  const res = await callRoute<Envelope<InvoiceBody>>(createInvoiceRoute, {
    method: "POST", url: schoolUrl("/invoices"), bearer: fx.adminToken, json: { studentId, ...periodAt(offsetMonths), amount, ...extra },
  });
  if (res.status !== 201 || !res.body) throw new Error(`issueInvoice gagal ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

/** Pola kotak acak deterministik per seed -> dHash berbeda antar-seed, identik untuk seed sama. */
export async function proofImage(seed: number, format: "jpeg" | "png" = "jpeg"): Promise<Blob> {
  const size = 12;
  let state = (seed * 2_654_435_761) % 4_294_967_296 || 1;
  const next = (): number => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state % 256;
  };
  const raw = Buffer.from(Array.from({ length: size * size * 3 }, next));
  const img = sharp(raw, { raw: { width: size, height: size, channels: 3 } }).resize(480, 480, { kernel: "nearest" });
  const bytes = format === "png" ? await img.png().toBuffer() : await img.jpeg({ quality: 90 }).toBuffer();
  return new Blob([new Uint8Array(bytes)], { type: format === "png" ? "image/png" : "image/jpeg" });
}

let proofSeed = Math.floor(Math.random() * 1_000_000);

export interface ProofFields {
  readonly amount: number | string;
  readonly transferDate?: LocalDate;
  readonly senderName?: string;
  readonly senderBank?: string;
  readonly note?: string;
  readonly file?: Blob;
}

export async function proofForm(fields: ProofFields): Promise<FormData> {
  proofSeed += 1;
  const form = new FormData();
  form.set("amount", String(fields.amount));
  form.set("transferDate", fields.transferDate ?? todayWib());
  form.set("senderName", fields.senderName ?? "Wali Siswa");
  form.set("senderBank", fields.senderBank ?? "BRI");
  if (fields.note) form.set("note", fields.note);
  form.set("file", fields.file ?? (await proofImage(proofSeed)), "bukti.jpg");
  return form;
}

export interface SubmissionBody {
  readonly id: string;
  readonly status: string;
  readonly amount: number;
  readonly proofFileId: string;
  readonly reviewNote: string | null;
}

/** Multipart dengan parameter path (helper callMultipart bersama tidak meneruskan params). */
export async function callMultipartWithParams<T = Envelope>(
  handler: AnyRouteHandler,
  options: { url: string; form: FormData; bearer?: string; params: Record<string, string> },
): Promise<{ status: number; headers: Headers; body: T | null }> {
  const encoded = new Request("http://localhost/encode", { method: "POST", body: options.form });
  const body = new Uint8Array(await encoded.arrayBuffer());
  const headers = new Headers({ "content-type": encoded.headers.get("content-type") ?? "", "content-length": String(body.byteLength) });
  if (options.bearer) headers.set("authorization", `Bearer ${options.bearer}`);
  const request = new NextRequest(new URL(options.url, "http://localhost"), { method: "POST", headers, body });
  const response = await handler(request, { params: Promise.resolve(options.params) as Promise<never> });
  const text = response.headers.get("content-type")?.includes("json") ? await response.text() : "";
  return { status: response.status, headers: response.headers, body: text ? (JSON.parse(text) as T) : null };
}

export async function submitProof(student: StudentWithToken, invoiceId: string, fields: ProofFields) {
  return callMultipartWithParams<Envelope<SubmissionBody>>(submitRoute, {
    url: `/api/v1/student/invoices/${invoiceId}/submissions`, form: await proofForm(fields), bearer: student.token, params: { id: invoiceId },
  });
}
