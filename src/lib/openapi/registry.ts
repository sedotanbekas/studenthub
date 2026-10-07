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
import { webPushContracts } from "@/lib/push/web/contracts";
import { attendanceContracts } from "@/lib/attendance/contracts";
import { reportCardsContracts } from "@/lib/report-cards/contracts";
import { billingContracts } from "@/lib/billing/contracts";
import { announcementsContracts } from "@/lib/announcements/contracts";
import { dashboardContracts } from "@/lib/dashboard/contracts";
import { sponsorsContracts } from "@/lib/sponsors/contracts";
import { adsContracts } from "@/lib/ads/contracts";
import { loginHistoryContracts } from "@/lib/login-history/contracts";
import { schoolAdminsContracts } from "@/lib/school-admins/contracts";
import { accessRolesContracts } from "@/lib/roles/contracts";
import { appSettingsContracts } from "@/lib/app-settings/contracts";

/** Semua kontrak route /api/v1. Setiap domain WAJIB terdaftar di sini (dicek guard test). */
export const ALL_CONTRACTS: readonly AnyContract[] = [
  ...platformContracts,
  ...filesContracts,
  ...appSettingsContracts,
  ...authContracts,
  ...schoolsContracts,
  ...usersContracts,
  ...loginHistoryContracts,
  ...schoolAdminsContracts,
  ...accessRolesContracts,
  ...calendarContracts,
  ...academicsContracts,
  ...studentsContracts,
  ...notificationsContracts,
  ...webPushContracts,
  ...attendanceContracts,
  ...reportCardsContracts,
  ...billingContracts,
  ...announcementsContracts,
  ...dashboardContracts,
  ...sponsorsContracts,
  ...adsContracts,
];
