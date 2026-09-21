/**
 * Helper integrasi pengumuman: dua sekolah (IDOR), kelas, admin/super admin bertoken WEB, siswa per
 * status, dan pemanggil route /school/announcements*.
 */
import type { School, SchoolClass, StudentStatus } from "@prisma/client";
import { GET as listGet, POST as createPost } from "@/app/api/v1/school/announcements/route";
import { DELETE as itemDelete, GET as itemGet, PATCH as itemPatch } from "@/app/api/v1/school/announcements/[id]/route";
import { POST as cancelPost } from "@/app/api/v1/school/announcements/[id]/cancel/route";
import { POST as publishPost } from "@/app/api/v1/school/announcements/[id]/publish/route";
import { POST as previewPost } from "@/app/api/v1/school/announcements/recipient-preview/route";
import { createSessionToken } from "../helpers/auth";
import { uniq } from "../helpers/db";
import {
  createAcademicYearWithTerm,
  createClass,
  createSchool,
  createSchoolAdmin,
  createStudent,
  createSuperAdmin,
  type TestStudent,
} from "../helpers/factories";
import { callRoute, type Envelope, type RouteResult } from "../helpers/request";

export interface AnnouncementBody {
  id: string;
  category: string;
  title: string;
  body: string;
  audience: string;
  status: string;
  publishedAt: string | null;
  cancelledAt: string | null;
  recipientCount: number | null;
  author: { id: string; name: string };
  targets: { classes: Array<{ id: string; name: string }>; students: Array<{ id: string; name: string; nis: string }> };
  stats: { recipientCount: number; readCount: number };
  createdAt: string;
  updatedAt: string;
}

export interface SchoolFixture {
  readonly school: School;
  readonly classA: SchoolClass;
  readonly classB: SchoolClass;
  readonly adminId: string;
  readonly adminToken: string;
}

export async function webToken(userId: string): Promise<string> {
  return (await createSessionToken(userId, { platform: "WEB", deviceId: null })).token;
}

export async function createAnnouncementSchool(): Promise<SchoolFixture> {
  const school = await createSchool();
  const { academicYear } = await createAcademicYearWithTerm(school.id);
  const classA = await createClass(school.id, academicYear.id, { name: uniq("VIIA") });
  const classB = await createClass(school.id, academicYear.id, { name: uniq("VIIB") });
  const admin = await createSchoolAdmin(school.id);
  return { school, classA, classB, adminId: admin.id, adminToken: await webToken(admin.id) };
}

export async function superAdminToken(): Promise<string> {
  return webToken((await createSuperAdmin()).id);
}

export function studentIn(schoolId: string, classId: string | null, status: StudentStatus = "ACTIVE", isActive = true): Promise<TestStudent> {
  return createStudent(schoolId, { classId, status, isActive });
}

type Result<T> = Promise<RouteResult<Envelope<T>>>;
const withSchool = (path: string, schoolId?: string) => (schoolId ? `${path}${path.includes("?") ? "&" : "?"}schoolId=${schoolId}` : path);
const BASE = "/api/v1/school/announcements";

export function list<T = AnnouncementBody[]>(token: string, query = "", schoolId?: string): Result<T> {
  return callRoute<Envelope<T>>(listGet, { method: "GET", url: withSchool(`${BASE}${query ? `?${query}` : ""}`, schoolId), bearer: token });
}

export function create<T = AnnouncementBody>(token: string, json: unknown, schoolId?: string): Result<T> {
  return callRoute<Envelope<T>>(createPost, { method: "POST", url: withSchool(BASE, schoolId), bearer: token, json });
}

export function preview(token: string, json: unknown, schoolId?: string): Result<{ count: number }> {
  return callRoute<Envelope<{ count: number }>>(previewPost, { method: "POST", url: withSchool(`${BASE}/recipient-preview`, schoolId), bearer: token, json });
}

export function getOne(token: string, id: string, schoolId?: string): Result<AnnouncementBody> {
  return callRoute<Envelope<AnnouncementBody>>(itemGet, { method: "GET", url: withSchool(`${BASE}/${id}`, schoolId), bearer: token, params: { id } });
}

export function patch(token: string, id: string, json: unknown, schoolId?: string): Result<AnnouncementBody> {
  return callRoute<Envelope<AnnouncementBody>>(itemPatch, { method: "PATCH", url: withSchool(`${BASE}/${id}`, schoolId), bearer: token, json, params: { id } });
}

export function remove(token: string, id: string, schoolId?: string): Result<{ id: string; deleted: boolean }> {
  return callRoute<Envelope<{ id: string; deleted: boolean }>>(itemDelete, { method: "DELETE", url: withSchool(`${BASE}/${id}`, schoolId), bearer: token, params: { id } });
}

export function publish(token: string, id: string, schoolId?: string): Result<AnnouncementBody> {
  return callRoute<Envelope<AnnouncementBody>>(publishPost, { method: "POST", url: withSchool(`${BASE}/${id}/publish`, schoolId), bearer: token, params: { id } });
}

export function cancel(token: string, id: string, json: unknown = {}, schoolId?: string): Result<AnnouncementBody> {
  return callRoute<Envelope<AnnouncementBody>>(cancelPost, { method: "POST", url: withSchool(`${BASE}/${id}/cancel`, schoolId), bearer: token, json, params: { id } });
}

export const draftInput = (overrides: Record<string, unknown> = {}) => ({
  category: "EVENT",
  title: `Pengumuman ${uniq("a")}`,
  body: "Pentas seni akan diadakan hari Sabtu di aula sekolah.",
  audience: "ALL",
  ...overrides,
});

/** Buat draf lewat route; gagal keras bila bukan 201. */
export async function createDraft(fixture: SchoolFixture, overrides: Record<string, unknown> = {}): Promise<AnnouncementBody> {
  const res = await create(fixture.adminToken, draftInput(overrides));
  if (res.status !== 201 || !res.body) throw new Error(`Gagal membuat draf: ${res.status} ${JSON.stringify(res.body?.error)}`);
  return res.body.data;
}
