import type { JobContext } from "@/lib/auth/principal";
import type { Prisma } from "@/lib/db";

/** Cakupan test job per sekolah: bila ctx.scope diisi, hanya schoolIds yang disebut (kosong = tidak ada). */
export function schoolScopeFilter(ctx: JobContext): Prisma.SchoolWhereInput {
  return ctx.scope ? { id: { in: [...(ctx.scope.schoolIds ?? [])] } } : {};
}
