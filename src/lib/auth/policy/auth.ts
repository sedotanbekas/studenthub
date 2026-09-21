import type { PolicyRule } from "./types";

/** Aksi POLICY domain auth (diisi oleh fase implementasi domain ini). */
export const authPolicy = {} as const satisfies Record<string, PolicyRule>;
