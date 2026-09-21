import type { AnyContract } from "@/lib/http/contract";
import { attendanceAdminContracts } from "./contracts-admin";
import { attendanceLeaveContracts } from "./contracts-leave";
import { attendanceMonitorContracts } from "./contracts-monitor";
import { attendanceStudentContracts } from "./contracts-student";

/** Gabungan kontrak domain absensi; tiap bagian dimiliki satu berkas contracts-*.ts. */
export const attendanceContracts: readonly AnyContract[] = [
  ...attendanceStudentContracts,
  ...attendanceLeaveContracts,
  ...attendanceAdminContracts,
  ...attendanceMonitorContracts,
];
