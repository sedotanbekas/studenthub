import type { Role } from "./types";

/**
 * Aturan tampilan akun di layar super admin (detail sekolah & Pengguna). Murni: data dari GET /platform/users
 * (src/lib/users/schemas.ts PlatformUser). Kata sandi pilihan pengguna tidak pernah tersedia (hash satu arah);
 * yang tampil apa adanya hanya kata sandi bawaan siswa.
 */
export type LoginKind = "NISN" | "NPSN" | "EMAIL";
export type PasswordKind = "DEFAULT" | "TEMPORARY" | "ADMIN_SET" | "OWN";

export interface PasswordView {
  readonly kind: PasswordKind;
  readonly plain: string | null;
  readonly expiresAt: string | null;
  readonly expired: boolean;
  readonly changedAt: string | null;
}

export interface AccountView {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
  readonly isActive: boolean;
  readonly adminKind: "PRIMARY" | "ADDITIONAL" | null;
  readonly student: { readonly id: string; readonly nisn: string; readonly nis: string; readonly status: string; readonly className: string | null } | null;
  readonly sponsor: { readonly companyName: string } | null;
}

export interface AccountRow extends AccountView {
  readonly email: string | null;
  readonly school: { readonly id: string; readonly name: string } | null;
  readonly lastLoginAt: string | null;
  /** Opsional: data demo lama/klien lama mungkin belum memuatnya. */
  readonly logins?: ReadonlyArray<{ readonly kind: LoginKind; readonly value: string }>;
  readonly password?: PasswordView;
}

/** Waktu WIB (zona pemilik platform), sama dengan layar super admin lain (review-rules). */
export function shortDateTime(iso: string): string {
  return `${new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso))} WIB`;
}

export function accountBadge(account: AccountView): string {
  if (account.role === "STUDENT") return `Siswa · ${account.student?.className ?? "belum ada kelas"}`;
  if (account.role === "SCHOOL_ADMIN") return account.adminKind === "PRIMARY" ? "Admin utama" : "Admin tambahan (guru)";
  if (account.role === "SPONSOR") return account.sponsor ? `Sponsor · ${account.sponsor.companyName}` : "Sponsor";
  return "Super admin";
}

const LOGIN_KIND_LABELS: Readonly<Record<LoginKind, string>> = { NISN: "NISN", NPSN: "NPSN sekolah", EMAIL: "Email" };
export const loginKindLabel = (kind: LoginKind): string => LOGIN_KIND_LABELS[kind];

export type SummaryTone = "info" | "warn" | "danger" | "muted";
export interface PasswordSummary {
  readonly tone: SummaryTone;
  readonly title: string;
  readonly detail: string;
  /** Teks kata sandi apa adanya (hanya kata sandi bawaan siswa). */
  readonly plain: string | null;
}

function expiryDetail(password: PasswordView, valid: string): string {
  if (!password.expiresAt) return valid;
  const when = shortDateTime(password.expiresAt);
  return password.expired ? `Kedaluwarsa sejak ${when} — login ditolak sampai di-reset.` : `${valid} Berlaku s/d ${when}.`;
}

export function passwordSummary(password: PasswordView | undefined): PasswordSummary {
  if (!password) return { tone: "muted", title: "Status kata sandi tidak tersedia", detail: "", plain: null };
  const tone: SummaryTone = password.expired ? "danger" : "info";
  switch (password.kind) {
    case "DEFAULT":
      return { tone, title: "Masih kata sandi bawaan", detail: expiryDetail(password, "Wajib diganti saat masuk pertama."), plain: password.plain };
    case "TEMPORARY":
      return { tone: password.expired ? "danger" : "warn", title: "Kata sandi sementara (acak)", detail: expiryDetail(password, "Hanya tampil sekali saat dibuat/di-reset; reset untuk membuat yang baru."), plain: null };
    case "ADMIN_SET":
      return { tone: "warn", title: "Ditentukan admin, belum diganti", detail: "Pengguna wajib menggantinya saat masuk pertama.", plain: null };
    default:
      return {
        tone: "muted",
        title: "Sudah diganti pemiliknya",
        detail: `${password.changedAt ? `Diganti ${shortDateTime(password.changedAt)}. ` : ""}Tidak dapat dilihat (tersimpan satu arah) — pakai Reset bila perlu.`,
        plain: null,
      };
  }
}

export function groupSummary(counts: { readonly schoolAdmins: number; readonly students: number }): string {
  if (counts.schoolAdmins === 0 && counts.students === 0) return "Belum ada akun";
  return `${counts.schoolAdmins} admin · ${counts.students} siswa`;
}

/**
 * Reset kata sandi: siswa lewat endpoint siswa dengan sekolah siswa itu sendiri (bukan pemilih sekolah hub), akun lain
 * lewat endpoint platform (body opsional kosong = sistem membuat kata sandi sementara).
 */
export function resetRequest(account: AccountRow): { path: string; body?: string } {
  if (account.role === "STUDENT" && account.student && account.school) {
    return { path: `/school/students/${encodeURIComponent(account.student.id)}/reset-password?schoolId=${encodeURIComponent(account.school.id)}` };
  }
  return { path: `/platform/users/${encodeURIComponent(account.id)}/reset-password`, body: "{}" };
}

/** "Masuk sebagai" (pemilik 2026-10-05): semua akun kecuali super admin; akun nonaktif memang tidak bisa masuk. */
export function canImpersonate(account: Pick<AccountView, "role" | "isActive">): boolean {
  return account.role !== "SUPER_ADMIN" && account.isActive;
}
