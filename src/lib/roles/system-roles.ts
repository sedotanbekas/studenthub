import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { RoleGrantSource } from "./rules";

/**
 * Peran sistem per jenis akun, di-cache singkat dalam proses (getAuth memanggilnya untuk akun tanpa
 * accessRoleId pada SETIAP request). Proses PM2 tunggal per lingkungan: perubahan peran lewat service
 * memanggil invalidateSystemRoles() sehingga berlaku seketika; TTL hanya jaring pengaman.
 */
const TTL_MS = 30_000;
let cache: { at: number; byBase: Map<UserRole, RoleGrantSource> } | null = null;

export async function systemRoleFor(base: UserRole, now: number = Date.now()): Promise<RoleGrantSource | null> {
  if (!cache || now - cache.at > TTL_MS) {
    const rows = await prisma.accessRole.findMany({
      where: { isSystem: true },
      select: { baseRole: true, isSystem: true, permissions: true, knownActions: true },
    });
    cache = { at: now, byBase: new Map(rows.map((row) => [row.baseRole, row])) };
  }
  return cache.byBase.get(base) ?? null;
}

export function invalidateSystemRoles(): void {
  cache = null;
}
