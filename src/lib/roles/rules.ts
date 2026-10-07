import type { UserRole } from "@prisma/client";
import { POLICY, type Action } from "@/lib/auth/policy";
import { badRequest, conflict, unprocessable } from "@/lib/http/errors";

/**
 * Aturan murni RBAC (permintaan pemilik 2026-10-07), tanpa Prisma.
 *
 * Hak efektif sebuah akun = aksi yang diizinkan POLICY untuk jenis akunnya (baseRole) DAN dicentang di
 * peran aksesnya. RBAC hanya mempersempit: jenis akun tetap menentukan cakupan data (sekolah/sponsor/siswa).
 * Aksi yang belum dikenal peran (ditambahkan sesudah peran terakhir disimpan): peran sistem mengikuti
 * bawaan POLICY (fitur baru langsung tersedia), peran buatan tidak (fitur baru tidak terbuka diam-diam).
 */

/** Selalu dicentang & tidak bisa dicabut: tanpa ini akun tidak bisa masuk, keluar, atau mengamankan dirinya. */
export const ALWAYS_GRANTED: ReadonlySet<Action> = new Set<Action>([
  "auth.self",
  "auth.account",
  "auth.totp",
  "auth.email",
  "notification.self",
  "notification.push",
  "file.read",
]);

/** Terkunci pada peran SISTEM per jenis akun: pencegah super admin mengunci dirinya dari pengelolaan peran. */
export const SYSTEM_LOCKED: Readonly<Partial<Record<UserRole, readonly Action[]>>> = {
  SUPER_ADMIN: ["roles.read", "roles.manage", "users.manage"],
};

export const SYSTEM_ROLE_KEYS: Readonly<Record<UserRole, string>> = {
  SUPER_ADMIN: "super-admin",
  SCHOOL_ADMIN: "admin-sekolah",
  SPONSOR: "sponsor",
  STUDENT: "siswa",
};

export const ALL_ACTIONS = Object.keys(POLICY) as Action[];

/** Aksi yang mungkin dimiliki jenis akun ini menurut POLICY (batas atas peran mana pun). */
export function actionsForBase(base: UserRole): Action[] {
  return ALL_ACTIONS.filter((action) => (POLICY[action].roles as readonly UserRole[]).includes(base));
}

/** Aksi terkunci (wajib tercentang) untuk sebuah peran. */
export function lockedActions(base: UserRole, isSystem: boolean): Action[] {
  const allowed = new Set(actionsForBase(base));
  const locked = [...ALWAYS_GRANTED, ...(isSystem ? (SYSTEM_LOCKED[base] ?? []) : [])];
  return [...new Set(locked)].filter((action) => allowed.has(action));
}

export interface RoleGrantSource {
  readonly isSystem: boolean;
  readonly permissions: unknown;
  readonly knownActions: unknown;
}

const asStringSet = (value: unknown): Set<string> =>
  new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

/** Hak efektif peran untuk jenis akun `base`. */
export function resolveGrants(source: RoleGrantSource, base: UserRole): Set<Action> {
  const checked = asStringSet(source.permissions);
  const known = asStringSet(source.knownActions);
  const locked = new Set(lockedActions(base, source.isSystem));
  const granted = new Set<Action>();
  for (const action of actionsForBase(base)) {
    const on = locked.has(action) || (known.has(action) ? checked.has(action) : source.isSystem);
    if (on) granted.add(action);
  }
  return granted;
}

/**
 * Centang yang disimpan: hanya aksi yang mungkin untuk jenis akun ini, ditambah aksi terkunci, terurut.
 * Aksi tak dikenal / bukan untuk jenis akun ini -> 422 INVALID_PERMISSION (bukan diam-diam dibuang).
 */
export function normalizePermissions(base: UserRole, isSystem: boolean, input: readonly string[]): Action[] {
  const allowed = new Set<string>(actionsForBase(base));
  const invalid = input.filter((action) => !allowed.has(action));
  if (invalid.length > 0) {
    throw unprocessable("INVALID_PERMISSION", `Hak akses tidak berlaku untuk jenis akun ini: ${invalid.slice(0, 5).join(", ")}.`);
  }
  const merged = new Set<string>([...input, ...lockedActions(base, isSystem)]);
  return ALL_ACTIONS.filter((action) => merged.has(action));
}

/** Slug kunci peran dari nama: huruf kecil, angka, tanda hubung. */
export function roleKeyFromName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  if (!slug) throw badRequest("ROLE_NAME_INVALID", "Nama peran harus memuat huruf atau angka.");
  return slug;
}

/** Peran yang dipasang ke akun wajib berbasis jenis akun yang sama. */
export function assertRoleMatchesAccount(roleBase: UserRole, accountRole: UserRole): void {
  if (roleBase !== accountRole) {
    throw unprocessable("ROLE_BASE_MISMATCH", "Peran ini untuk jenis akun lain. Pilih peran yang sesuai jenis akun.");
  }
}

/** Peran sistem tidak bisa dihapus; peran buatan yang masih dipakai tetap boleh (akunnya kembali ke peran sistem). */
export function assertDeletable(role: { readonly isSystem: boolean }): void {
  if (role.isSystem) throw conflict("SYSTEM_ROLE_LOCKED", "Peran bawaan tidak bisa dihapus. Ubah centangnya saja.");
}

/**
 * Pencegah terkunci sendiri: super admin yang menyimpan peran miliknya sendiri tanpa hak kelola peran,
 * atau memasang peran tanpa hak kelola peran ke akunnya sendiri, ditolak.
 */
export function assertNotSelfLockout(grants: ReadonlySet<Action>, affectsActor: boolean): void {
  if (affectsActor && !grants.has("roles.manage")) {
    throw unprocessable("ROLE_SELF_LOCKOUT", "Perubahan ini mencabut hak Anda mengelola peran. Sisakan centang 'Kelola peran & hak akses'.");
  }
}
