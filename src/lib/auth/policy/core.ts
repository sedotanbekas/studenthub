import { ALL_ROLES, ALL_SPONSOR_STATUSES, ALL_STUDENT_STATUSES, type PolicyRule } from "./types";

/** Aksi lintas domain (inti platform). Domain lain menambah berkas policy/<domain>.ts. */
export const corePolicy = {
  "auth.self": {
    roles: ALL_ROLES,
    studentStatuses: ALL_STUDENT_STATUSES,
    sponsorStatuses: ALL_SPONSOR_STATUSES,
    allowDuringPasswordChange: true,
  },
  "notification.self": {
    roles: ALL_ROLES,
    studentStatuses: ALL_STUDENT_STATUSES,
    sponsorStatuses: ALL_SPONSOR_STATUSES,
  },
  "file.read": {
    roles: ALL_ROLES,
    studentStatuses: ALL_STUDENT_STATUSES,
    sponsorStatuses: ALL_SPONSOR_STATUSES,
  },
  "region.read": {
    roles: ["SUPER_ADMIN", "SCHOOL_ADMIN", "SPONSOR"],
    sponsorStatuses: ALL_SPONSOR_STATUSES,
  },
  "platform.jobs.read": { roles: ["SUPER_ADMIN"] },
} as const satisfies Record<string, PolicyRule>;
