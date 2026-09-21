/**
 * Pembantu integration test domain akademik & kalender: dua sekolah (IDOR), token per peran,
 * dan URL dengan ?schoolId=.
 */
import { createSessionToken } from "../helpers/auth";
import { prisma } from "../helpers/db";
import { createSchool, createSchoolAdmin, createStudent, createSuperAdmin, type CreateSchoolOptions } from "../helpers/factories";

export interface Tenant {
  readonly schoolId: string;
  readonly adminToken: string;
}

export interface TwoTenants {
  readonly a: Tenant;
  readonly b: Tenant;
  readonly superToken: string;
  /** Siswa AKTIF sekolah A (untuk uji 403 peran). */
  readonly studentToken: string;
}

export async function webToken(userId: string): Promise<string> {
  return (await createSessionToken(userId, { platform: "WEB", deviceId: null })).token;
}

export async function createTenant(options: CreateSchoolOptions = {}): Promise<Tenant> {
  const school = await createSchool(options);
  const admin = await createSchoolAdmin(school.id);
  return { schoolId: school.id, adminToken: await webToken(admin.id) };
}

export async function setupTenants(options: CreateSchoolOptions = {}): Promise<TwoTenants> {
  const [a, b] = [await createTenant(options), await createTenant(options)];
  const superAdmin = await createSuperAdmin();
  const { user } = await createStudent(a.schoolId);
  return { a, b, superToken: await webToken(superAdmin.id), studentToken: (await createSessionToken(user.id)).token };
}

/** Tambahkan ?schoolId= (atau &schoolId=) bila diisi. */
export function withSchool(url: string, schoolId?: string): string {
  if (!schoolId) return url;
  return `${url}${url.includes("?") ? "&" : "?"}schoolId=${encodeURIComponent(schoolId)}`;
}

/** Audit terakhir untuk entitas + aksi (memastikan audit ditulis di transaksi yang sama). */
export function findAudit(entityId: string, action: string) {
  return prisma.auditLog.findFirst({ where: { entityId, action }, orderBy: { createdAt: "desc" } });
}
