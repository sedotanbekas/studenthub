import type { PolicyRule } from "./types";

/** Aksi POLICY domain users (diisi oleh fase implementasi domain ini). */
export const usersPolicy = {} as const satisfies Record<string, PolicyRule>;
