/** Aturan murni "Ingat perangkat ini" (tanpa Prisma). Layanan: src/lib/auth/trusted-device.ts. */
export interface TrustedDeviceRow {
  readonly userId: string;
  readonly expiresAt: Date;
}

/** Token cocok hanya untuk pemiliknya dan sebelum kedaluwarsa. */
export function trustAccepted(row: TrustedDeviceRow | null, userId: string, now: Date): boolean {
  return row !== null && row.userId === userId && row.expiresAt.getTime() > now.getTime();
}
