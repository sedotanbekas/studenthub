import { prisma } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import type { MeDto } from "./auth-schemas";
import { toMe } from "./dto";
import { listAllowedActions } from "./policy";
import { requirePrincipal, type ActionContext } from "./principal";

/** GET /auth/me: identitas, cakupan (sekolah/siswa/sponsor), dan daftar aksi POLICY yang diizinkan. */
export async function getMe(ctx: ActionContext): Promise<MeDto> {
  const principal = requirePrincipal(ctx);
  const user = await prisma.user.findUnique({
    where: { id: principal.userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      mustChangePassword: true,
      totpEnabledAt: true,
      lastLoginAt: true,
      school: { select: { id: true, name: true, timezone: true } },
      student: { select: { id: true, nisn: true, nis: true, status: true, currentClass: { select: { name: true } } } },
      sponsor: { select: { id: true, companyName: true, status: true } },
    },
  });
  if (!user) throw notFound("Akun tidak ditemukan.");
  return toMe(user, listAllowedActions(principal));
}
