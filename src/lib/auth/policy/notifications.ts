import type { PolicyRule } from "./types";

/** Aksi POLICY domain notifications (diisi oleh fase implementasi domain ini). */
export const notificationsPolicy = {} as const satisfies Record<string, PolicyRule>;
