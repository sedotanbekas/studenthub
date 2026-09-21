import type { PolicyRule } from "./types";

/** Aksi POLICY domain attendance (diisi oleh fase implementasi domain ini). */
export const attendancePolicy = {} as const satisfies Record<string, PolicyRule>;
