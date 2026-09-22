import type { ClientPlatform, SponsorStatus, StudentStatus, UserRole } from "@prisma/client";

/**
 * Identitas pemanggil yang sudah terverifikasi (JWT + baris AuthSession hidup). Dibangun sekali
 * per request oleh getAuth dan TIDAK pernah diambil dari body request.
 */
export interface Principal {
  readonly userId: string;
  readonly sessionId: string;
  readonly role: UserRole;
  readonly name: string;
  readonly schoolId: string | null;
  readonly sponsorId: string | null;
  readonly studentId: string | null;
  readonly studentStatus: StudentStatus | null;
  readonly sponsorStatus: SponsorStatus | null;
  readonly mustChangePassword: boolean;
  /** SUPER_ADMIN yang belum mengaktifkan TOTP: semua aksi ditolak kecuali allowDuringTotpEnrollment. */
  readonly totpEnrollmentRequired: boolean;
  readonly platform: ClientPlatform;
  readonly deviceId: string | null;
}

/** Konteks aksi yang diteruskan ke setiap service. */
export interface ActionContext {
  readonly principal: Principal | null;
  readonly now: Date;
  readonly requestId: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
  /** Jadwalkan kerja setelah respons terkirim (mis. kirim push). */
  defer(task: () => Promise<void>): void;
}

/** Konteks untuk job cron (tanpa principal). */
export interface JobContext {
  readonly now: Date;
  readonly requestId: string;
  /** Batas waktu (epoch ms) agar tick tidak melampaui anggaran. */
  readonly deadline: number;
  /** Batasi cakupan pemindaian (untuk test). */
  readonly scope?: { readonly schoolIds?: readonly string[]; readonly userIds?: readonly string[] };
}

export function requirePrincipal(ctx: ActionContext): Principal {
  if (!ctx.principal) throw new Error("Principal wajib ada untuk aksi ini (bug: route publik memanggil service terautentikasi)");
  return ctx.principal;
}
