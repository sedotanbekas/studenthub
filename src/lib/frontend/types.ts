import type { SchoolThemeDto } from "@/lib/schools/theme-schemas";
import type { ImpersonationView } from "./impersonation-view";
/** Tema sekolah seperti dikirim API (SchoolTheme) — tipe dari kontrak backend. */
export type { SchoolThemeDto };
export type Row = Record<string, unknown>;
export type Role = "SCHOOL_ADMIN" | "SUPER_ADMIN" | "SPONSOR" | "STUDENT" | "REGION_ADMIN";
export interface Identity {
  /** `loginNpsn` opsional agar mock/persona lama tetap valid (terisi untuk admin utama sekolah). */
  user: { id: string; name: string; email: string | null; loginNpsn?: string | null; role: Role; mustChangePassword: boolean; totpEnrollmentRequired: boolean; totpEnabled?: boolean };
  /** `theme` dari GET /auth/me (tema warna sekolah); opsional agar mock/persona lama tetap valid. */
  school: { id: string; name: string; timezone: string; theme?: SchoolThemeDto } | null;
  sponsor: { id: string; companyName: string } | null;
  /** Wilayah Admin Pemda (GET /auth/me); opsional agar mock/persona lama tetap valid. */
  region?: { provinceCode: string; provinceName: string; cityCode: string | null; cityName: string | null } | null;
  permissions: string[];
  /** "Masuk sebagai" super admin (GET /auth/me); opsional agar mock/persona lama tetap valid. */
  impersonation?: ImpersonationView | null;
}
export interface Schema {
  $ref?: string; type?: string | string[]; properties?: Record<string, Schema>; required?: string[];
  items?: Schema; enum?: (string | number)[]; anyOf?: Schema[]; oneOf?: Schema[]; allOf?: Schema[];
  format?: string; default?: unknown; description?: string; example?: unknown; const?: unknown; lookup?: string;
  /** Saran isian (datalist) dari meta OpenAPI `x-suggestions`; isian bebas tetap diterima. */
  "x-suggestions"?: string[];
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number; pattern?: string;
}
export interface Parameter { name: string; in: string; required?: boolean; schema: Schema }
export interface Operation { id: string; path: string; method: string; title: string; action: string; parameters: Parameter[]; body?: Schema; multipart?: boolean }
export interface Envelope { success: boolean; data: unknown; meta?: { page?: number; total?: number; totalPages?: number; nextCursor?: string; hasMore?: boolean }; error?: { message: string; code: string; details?: unknown } }
export interface Module { key: string; title: string; description: string; icon: string; group: string; paths: string[]; primary?: string }
