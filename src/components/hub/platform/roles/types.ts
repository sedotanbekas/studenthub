/** Bentuk respons /access-roles* (src/lib/roles/schemas.ts) yang dipakai halaman Peran & hak akses. */
export interface AccessRole {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly baseRole: "SUPER_ADMIN" | "SCHOOL_ADMIN" | "SPONSOR" | "STUDENT" | "REGION_ADMIN";
  readonly isSystem: boolean;
  readonly permissions: readonly string[];
  readonly lockedPermissions: readonly string[];
  readonly availablePermissions: readonly string[];
  readonly userCount: number;
  readonly updatedAt: string;
}

export interface AccessRoleMember { readonly id: string; readonly name: string; readonly email: string | null; readonly schoolName: string | null; readonly isActive: boolean }

export interface CatalogItem { readonly action: string; readonly label: string; readonly hint: string; readonly baseRoles: readonly string[] }
export interface CatalogGroup { readonly group: string; readonly items: readonly CatalogItem[] }
