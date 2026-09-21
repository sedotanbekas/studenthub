import type { UserRole } from "@prisma/client";
import {
  BCRYPT_COST,
  checkPasswordPolicy,
  generateTempPassword,
  PASSWORD_VIOLATION_MESSAGES,
  TEMP_PASSWORD_BCRYPT_COST,
  TEMP_PASSWORD_TTL_MS,
  type PasswordContext,
} from "@/lib/auth/password";
import { badRequest, conflict, unprocessable } from "@/lib/http/errors";

/**
 * Aturan murni pengelolaan akun oleh SUPER_ADMIN (tanpa Prisma). Peran, sekolah, dan sponsor
 * akun tidak pernah berubah setelah dibuat; hanya nama & email yang dapat diedit.
 */
export const CREATABLE_ROLES = ["SUPER_ADMIN", "SCHOOL_ADMIN"] as const satisfies readonly UserRole[];

type Target = { readonly id: string; readonly role: UserRole };

export function assertCreatableRole(role: UserRole, schoolId: string | null | undefined): void {
  if (role === "SPONSOR" || role === "STUDENT") {
    throw badRequest(
      "USE_DEDICATED_ENDPOINT",
      role === "SPONSOR" ? "Akun sponsor dibuat lewat endpoint sponsor." : "Akun siswa dibuat lewat endpoint siswa sekolah.",
    );
  }
  if (role === "SCHOOL_ADMIN" && !schoolId) throw badRequest("SCHOOL_ID_REQUIRED", "schoolId wajib diisi untuk admin sekolah.");
  if (role === "SUPER_ADMIN" && schoolId) throw badRequest("SCHOOL_ID_NOT_ALLOWED", "Super admin tidak terikat sekolah; hapus schoolId.");
}

/** Nonaktifkan/aktifkan akun: status siswa dikelola lewat status siswa agar tetap selaras. */
export function assertStatusTarget(actorUserId: string, target: Target): void {
  if (target.role === "STUDENT") {
    throw badRequest("USE_STUDENT_STATUS", "Status akun siswa diubah lewat perubahan status siswa di sekolah.");
  }
  if (target.id === actorUserId) throw badRequest("CANNOT_TARGET_SELF", "Anda tidak dapat melakukan aksi ini pada akun sendiri.");
}

export function assertResetTarget(actorUserId: string, target: Target): void {
  if (target.role === "STUDENT") {
    throw badRequest("USE_STUDENT_ENDPOINT", "Kata sandi siswa direset lewat endpoint siswa sekolah.");
  }
  if (target.id === actorUserId) throw badRequest("USE_CHANGE_PASSWORD", "Gunakan fitur ganti kata sandi untuk akun sendiri.");
}

export function assertSessionTarget(actorUserId: string, target: Target): void {
  if (target.id === actorUserId) {
    throw badRequest("CANNOT_TARGET_SELF", "Gunakan logout dari semua perangkat untuk akun sendiri.");
  }
}

/** Nama siswa & data lainnya dikelola domain siswa (email siswa selalu kosong). */
export function assertEditableTarget(target: Target): void {
  if (target.role === "STUDENT") throw badRequest("USE_STUDENT_ENDPOINT", "Data akun siswa diubah lewat endpoint siswa sekolah.");
}

/** Dipanggil setelah lockKey('super-admins'): otherActiveSuperAdmins = SA aktif selain target. */
export function assertNotLastSuperAdmin(target: { readonly role: UserRole; readonly isActive: boolean }, otherActiveSuperAdmins: number): void {
  if (target.role === "SUPER_ADMIN" && target.isActive && otherActiveSuperAdmins === 0) {
    throw conflict("LAST_SUPER_ADMIN", "Super admin aktif terakhir tidak dapat dinonaktifkan.");
  }
}

export type CredentialPlan = {
  readonly kind: "TYPED" | "GENERATED";
  readonly plain: string;
  readonly cost: number;
  readonly tempPasswordExpiresAt: Date | null;
};

/**
 * Kata sandi awal/reset: yang diketik admin wajib lolos kebijakan (cost 10, tanpa kedaluwarsa);
 * bila kosong, sistem membuat kata sandi sementara (cost 8, kedaluwarsa 14 hari) yang ditampilkan sekali.
 */
export function planCredential(
  typed: string | undefined,
  ctx: PasswordContext,
  now: Date,
  generate: () => string = () => generateTempPassword(),
): CredentialPlan {
  if (typed === undefined) {
    return { kind: "GENERATED", plain: generate(), cost: TEMP_PASSWORD_BCRYPT_COST, tempPasswordExpiresAt: new Date(now.getTime() + TEMP_PASSWORD_TTL_MS) };
  }
  const violations = checkPasswordPolicy(typed, ctx);
  if (violations.length > 0) {
    // Bentuk details sama dengan ganti kata sandi (domain auth): { violations, messages }.
    const messages = violations.map((code) => PASSWORD_VIOLATION_MESSAGES[code]);
    throw unprocessable("PASSWORD_POLICY", messages[0] ?? "Kata sandi tidak memenuhi kebijakan.", { violations, messages });
  }
  return { kind: "TYPED", plain: typed, cost: BCRYPT_COST, tempPasswordExpiresAt: null };
}
