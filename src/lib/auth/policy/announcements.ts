import type { PolicyRule } from "./types";

/** Aksi POLICY domain announcements (diisi oleh fase implementasi domain ini). */
export const announcementsPolicy = {} as const satisfies Record<string, PolicyRule>;
