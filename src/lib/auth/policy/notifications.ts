import type { PolicyRule } from "./types";

/** Aksi POLICY domain notifications. */
export const notificationsPolicy = {
  /** Pilihan kabar sekolah akun sendiri (N2): admin utama & admin tambahan. */
  "notification.preferences": { roles: ["SCHOOL_ADMIN"] },
} as const satisfies Record<string, PolicyRule>;
