import { prisma } from "@/lib/db";
import { unauthorized } from "@/lib/http/errors";
import { verifyAccessToken } from "./access-token";
import type { Principal } from "./principal";
import { evaluatePrincipal, type SessionRow } from "./principal-rules";
import { superAdminTotpEnforced } from "./totp-switch";
import { regionSchoolWhere } from "@/lib/region/rules";
import { systemRoleFor } from "@/lib/roles/system-roles";

/**
 * Autentikasi request: hanya `Authorization: Bearer <access token>`. Skema lain (mis. Basic dari
 * halaman /docs) dianggap anonim. Setiap request memverifikasi baris AuthSession sehingga logout,
 * penonaktifan, dan ganti password berlaku seketika. Transport cookie menyusul di fase dashboard.
 */
export async function getAuth(req: Request, now: Date = new Date()): Promise<Principal | null> {
  const header = req.headers.get("authorization");
  if (!header || !/^Bearer\s+/i.test(header)) return null;
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (token.length === 0) throw unauthorized("UNAUTHENTICATED", "Token tidak valid.");
  const claims = await verifyAccessToken(token, now);
  const row = await withAccessRole(await loadSession(claims.sid));
  const result = evaluatePrincipal(row, claims, now, { totpEnforced: superAdminTotpEnforced() });
  if (!result.ok) {
    const message = result.code === "SESSION_INVALID" ? "Sesi tidak berlaku. Silakan login ulang." : "Akun tidak aktif.";
    throw unauthorized(result.code, message);
  }
  return result.principal.role === "REGION_ADMIN" ? withRegionSchool(result.principal, req) : result.principal;
}

/**
 * Admin Pemda: sekolah pada ?schoolId= request diverifikasi SEKALI di sini (ada & di provinsi/kota akun), lalu
 * resolveSchoolScope cukup membandingkan string (tetap sinkron di semua service).
 */
async function withRegionSchool(principal: Principal, req: Request): Promise<Principal> {
  const requested = new URL(req.url).searchParams.get("schoolId")?.trim();
  if (!requested || !principal.region) return principal;
  const school = await prisma.school.findFirst({ where: { id: requested, ...regionSchoolWhere(principal.region) }, select: { id: true } });
  return Object.freeze({ ...principal, regionSchoolId: school?.id ?? null });
}

async function loadSession(sessionId: string): Promise<SessionRow | null> {
  return prisma.authSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      platform: true,
      deviceId: true,
      revokedAt: true,
      expiresAt: true,
      impersonatorId: true,
      impersonator: { select: { isActive: true, role: true } },
      user: {
        select: {
          id: true,
          role: true,
          name: true,
          isActive: true,
          mustChangePassword: true,
          totpEnabledAt: true,
          schoolId: true,
          primarySchoolId: true,
          sponsorId: true,
          school: { select: { isActive: true } },
          student: { select: { id: true, status: true } },
          sponsor: { select: { status: true } },
          accessRole: { select: { isSystem: true, permissions: true, knownActions: true } },
          regionProvinceCode: true,
          regionCityCode: true,
        },
      },
    },
  });
}

/** RBAC: akun tanpa peran akses memakai peran sistem jenis akunnya (cache proses, src/lib/roles/system-roles.ts). */
async function withAccessRole(row: SessionRow | null): Promise<SessionRow | null> {
  if (!row || row.user.accessRole) return row;
  return { ...row, user: { ...row.user, accessRole: await systemRoleFor(row.user.role) } };
}
