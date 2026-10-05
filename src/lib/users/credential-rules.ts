import type { UserRole } from "@prisma/client";
import { DEFAULT_STUDENT_PASSWORD } from "@/lib/students/constants";

/**
 * Cara & status masuk sebuah akun untuk layar super admin (murni, tanpa Prisma). Kata sandi disimpan sebagai hash
 * bcrypt (satu arah), jadi kata sandi pilihan pengguna TIDAK PERNAH terbaca; yang dikenali hanya kata sandi bawaan
 * siswa (DEFAULT_STUDENT_PASSWORD) dengan mencocokkan hash-nya.
 */
export const LOGIN_KINDS = ["NISN", "NPSN", "EMAIL"] as const;
export type LoginKind = (typeof LOGIN_KINDS)[number];
export interface LoginIdentifier {
  readonly kind: LoginKind;
  readonly value: string;
}

export interface LoginSource {
  readonly role: UserRole;
  readonly email: string | null;
  /** NPSN sekolah bila akun ini admin utama (User.primarySchoolId). */
  readonly primaryNpsn: string | null;
  /** Student.activeNisn = kunci login siswa; NULL (draf/dilepas) = belum bisa masuk. */
  readonly activeNisn: string | null;
}

/** Sama dengan pencarian akun di login-service: NISN aktif hanya siswa, NPSN hanya admin utama, email non-siswa. */
export function loginIdentifiers(source: LoginSource): LoginIdentifier[] {
  if (source.role === "STUDENT") return source.activeNisn ? [{ kind: "NISN", value: source.activeNisn }] : [];
  return [
    ...(source.primaryNpsn ? [{ kind: "NPSN" as const, value: source.primaryNpsn }] : []),
    ...(source.email ? [{ kind: "EMAIL" as const, value: source.email }] : []),
  ];
}

/**
 * DEFAULT = masih kata sandi bawaan siswa (teksnya ditampilkan); TEMPORARY = sementara acak (hanya tampil sekali saat
 * dibuat/di-reset); ADMIN_SET = ditentukan admin, wajib diganti; OWN = sudah diganti pemilik akun.
 */
export const PASSWORD_KINDS = ["DEFAULT", "TEMPORARY", "ADMIN_SET", "OWN"] as const;
export type PasswordKind = (typeof PASSWORD_KINDS)[number];

export interface PasswordStateInput {
  readonly mustChangePassword: boolean;
  readonly tempPasswordExpiresAt: Date | null;
  readonly passwordChangedAt: Date | null;
  /** Hash cocok dengan DEFAULT_STUDENT_PASSWORD (hanya diperiksa bila needsDefaultCheck). */
  readonly matchesDefault: boolean;
}

export interface PasswordState {
  readonly kind: PasswordKind;
  readonly plain: string | null;
  readonly expiresAt: string | null;
  /** Sama dengan login: ditolak TEMP_PASSWORD_EXPIRED bila kedaluwarsa < sekarang. */
  readonly expired: boolean;
  readonly changedAt: string | null;
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export function passwordState(input: PasswordStateInput, now: Date): PasswordState {
  const changedAt = iso(input.passwordChangedAt);
  if (!input.mustChangePassword) return { kind: "OWN", plain: null, expiresAt: null, expired: false, changedAt };
  const expiry = input.tempPasswordExpiresAt;
  const kind: PasswordKind = input.matchesDefault ? "DEFAULT" : expiry !== null ? "TEMPORARY" : "ADMIN_SET";
  return {
    kind,
    plain: input.matchesDefault ? DEFAULT_STUDENT_PASSWORD : null,
    expiresAt: iso(expiry),
    expired: expiry !== null && expiry.getTime() < now.getTime(),
    changedAt,
  };
}

/** Kata sandi bawaan hanya diberikan ke siswa dan selalu wajib diganti; akun lain tidak perlu dicocokkan. */
export function needsDefaultCheck(role: UserRole, mustChangePassword: boolean): boolean {
  return role === "STUDENT" && mustChangePassword;
}
