import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ispSummary, locationSummary } from "@/lib/geoip/rules";
import { toSkipTake } from "@/lib/http/pagination";
import { deviceSummary, failureCodeOf } from "./rules";
import type { LoginEventDto, LoginHistoryQuery } from "./schemas";

/** Riwayat masuk semua akun, terbaru dulu (dibaca SUPER_ADMIN, limit <= 100). */
const EVENT_SELECT = {
  id: true,
  createdAt: true,
  succeeded: true,
  failureCode: true,
  platform: true,
  ipAddress: true,
  userAgent: true,
  deviceId: true,
  deviceName: true,
  deviceType: true,
  browser: true,
  os: true,
  deviceModel: true,
  isNewDevice: true,
  city: true,
  region: true,
  countryCode: true,
  asn: true,
  isp: true,
  user: { select: { id: true, name: true, email: true, role: true, school: { select: { id: true, name: true } } } },
} as const satisfies Prisma.LoginEventSelect;

type EventRow = Prisma.LoginEventGetPayload<{ select: typeof EVENT_SELECT }>;

export function toLoginEventDto(row: EventRow): LoginEventDto {
  return {
    id: row.id,
    occurredAt: row.createdAt.toISOString(),
    status: row.succeeded ? "SUCCESS" : "FAILED",
    // Nilai asing (mis. kode lama) tetap valid sebagai OTHER.
    failureReason: row.succeeded ? null : (failureCodeOf(row.failureCode) ?? "OTHER"),
    user: row.user,
    device: deviceSummary(row),
    isNewDevice: row.isNewDevice,
    location: locationSummary(row),
    isp: ispSummary(row.isp, row.asn),
    ipAddress: row.ipAddress,
    platform: row.platform,
    deviceType: row.deviceType,
    browser: row.browser,
    os: row.os,
    deviceModel: row.deviceModel,
    deviceName: row.deviceName,
    deviceId: row.deviceId,
    countryCode: row.countryCode,
    userAgent: row.userAgent,
  };
}

function historyWhere(query: LoginHistoryQuery): Prisma.LoginEventWhereInput {
  return {
    ...(query.userId ? { userId: query.userId } : {}),
    ...(query.role || query.schoolId ? { user: { ...(query.role ? { role: query.role } : {}), ...(query.schoolId ? { schoolId: query.schoolId } : {}) } } : {}),
    ...(query.status ? { succeeded: query.status === "SUCCESS" } : {}),
    ...(query.isNewDevice !== undefined ? { isNewDevice: query.isNewDevice } : {}),
  };
}

export async function listLoginHistory(query: LoginHistoryQuery): Promise<{ items: LoginEventDto[]; total: number }> {
  const where = historyWhere(query);
  const [total, rows] = await Promise.all([
    prisma.loginEvent.count({ where }),
    prisma.loginEvent.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...toSkipTake(query), select: EVENT_SELECT }),
  ]);
  return { items: rows.map(toLoginEventDto), total };
}
