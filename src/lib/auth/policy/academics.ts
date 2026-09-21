import { ADMINS, type PolicyRule } from "./types";

/** Aksi POLICY domain academics (tahun ajaran, semester, kelas, mapel). */
export const academicsPolicy = {
  "academics.read": { roles: ADMINS },
  "academics.manage": { roles: ADMINS },
} as const satisfies Record<string, PolicyRule>;
