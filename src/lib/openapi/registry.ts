import type { AnyContract } from "@/lib/http/contract";
import { platformContracts } from "@/lib/platform/contracts";
import { filesContracts } from "@/lib/platform/files-contracts";
import { authContracts } from "@/lib/auth/contracts";
import { schoolsContracts } from "@/lib/schools/contracts";
import { usersContracts } from "@/lib/users/contracts";
import { calendarContracts } from "@/lib/calendar/contracts";
import { academicsContracts } from "@/lib/academics/contracts";
import { studentsContracts } from "@/lib/students/contracts";
import { notificationsContracts } from "@/lib/notifications/contracts";
import { attendanceContracts } from "@/lib/attendance/contracts";
import { reportCardsContracts } from "@/lib/report-cards/contracts";
import { billingContracts } from "@/lib/billing/contracts";
import { announcementsContracts } from "@/lib/announcements/contracts";
import { dashboardContracts } from "@/lib/dashboard/contracts";
import { sponsorsContracts } from "@/lib/sponsors/contracts";
import { adsContracts } from "@/lib/ads/contracts";

/** Semua kontrak route /api/v1. Setiap domain WAJIB terdaftar di sini (dicek guard test). */
export const ALL_CONTRACTS: readonly AnyContract[] = [
  ...platformContracts,
  ...filesContracts,
  ...authContracts,
  ...schoolsContracts,
  ...usersContracts,
  ...calendarContracts,
  ...academicsContracts,
  ...studentsContracts,
  ...notificationsContracts,
  ...attendanceContracts,
  ...reportCardsContracts,
  ...billingContracts,
  ...announcementsContracts,
  ...dashboardContracts,
  ...sponsorsContracts,
  ...adsContracts,
];
