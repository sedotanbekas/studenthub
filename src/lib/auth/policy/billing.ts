import type { PolicyRule } from "./types";

/** Aksi POLICY domain billing (diisi oleh fase implementasi domain ini). */
export const billingPolicy = {} as const satisfies Record<string, PolicyRule>;
