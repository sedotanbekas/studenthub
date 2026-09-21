import type { Principal } from "./principal";

/** Pembuat Principal untuk unit test (bukan untuk kode produksi). */
export function makePrincipal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: "user_1",
    sessionId: "sess_1",
    role: "SCHOOL_ADMIN",
    name: "Admin Uji",
    schoolId: "school_1",
    sponsorId: null,
    studentId: null,
    studentStatus: null,
    sponsorStatus: null,
    mustChangePassword: false,
    platform: "ANDROID",
    deviceId: null,
    ...overrides,
  };
}
