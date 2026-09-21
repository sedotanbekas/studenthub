import type { PolicyRule } from "./types";

/** Aksi POLICY domain report-cards (diisi oleh fase implementasi domain ini). */
export const reportCardsPolicy = {} as const satisfies Record<string, PolicyRule>;
