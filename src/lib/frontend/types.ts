export type Row = Record<string, unknown>;
export type Role = "SCHOOL_ADMIN" | "SUPER_ADMIN" | "SPONSOR" | "STUDENT";
export interface Identity {
  user: { id: string; name: string; email: string | null; role: Role; mustChangePassword: boolean; totpEnrollmentRequired: boolean };
  school: { id: string; name: string; timezone: string } | null;
  sponsor: { id: string; companyName: string } | null;
  permissions: string[];
}
export interface Schema {
  $ref?: string; type?: string | string[]; properties?: Record<string, Schema>; required?: string[];
  items?: Schema; enum?: (string | number)[]; anyOf?: Schema[]; oneOf?: Schema[]; allOf?: Schema[];
  format?: string; default?: unknown; description?: string; example?: unknown; const?: unknown; lookup?: string;
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number; pattern?: string;
}
export interface Parameter { name: string; in: string; required?: boolean; schema: Schema }
export interface Operation { id: string; path: string; method: string; title: string; action: string; parameters: Parameter[]; body?: Schema; multipart?: boolean }
export interface Envelope { success: boolean; data: unknown; meta?: { page?: number; total?: number; totalPages?: number; nextCursor?: string; hasMore?: boolean }; error?: { message: string; code: string; details?: unknown } }
export interface Module { key: string; title: string; description: string; icon: string; group: string; paths: string[]; primary?: string }
