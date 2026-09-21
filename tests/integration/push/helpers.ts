/**
 * Helper integrasi dispatcher push: siswa dengan sesi bertoken Expo, notifikasi PENDING lewat jalur tulis
 * resmi (notifyUsers dalam withTx), dan JobContext ber-cakupan user milik test (DB uji dipakai ulang).
 */
import type { JobContext } from "@/lib/auth/principal";
import { notifyUsers } from "@/lib/notifications/notify";
import { memoryPushTransport } from "@/lib/push/transports/memory";
import type { PushMessage } from "@/lib/push/types";
import { withTx } from "@/lib/tx";
import { createSessionToken } from "../helpers/auth";
import { prisma, uniq } from "../helpers/db";
import { createSchool, createStudent, type TestStudent } from "../helpers/factories";

export interface Device {
  readonly sessionId: string;
  readonly token: string;
}

export interface StudentWithDevices extends TestStudent {
  readonly devices: readonly Device[];
}

const DAY_MS = 86_400_000;

export const expoToken = (): string => `ExponentPushToken[${uniq("tok").replace(/[^A-Za-z0-9_-]/g, "_")}]`;

/** Sesi ANDROID dengan token Expo; `state` membuat sesi dicabut/kedaluwarsa (harus dilewati). */
export async function addDevice(userId: string, state: "live" | "revoked" | "expired" = "live"): Promise<Device> {
  const { sessionId } = await createSessionToken(userId, { deviceId: uniq("dev") });
  const token = expoToken();
  await prisma.authSession.update({
    where: { id: sessionId },
    data: {
      expoPushToken: token,
      ...(state === "revoked" ? { revokedAt: new Date(), revokeReason: "LOGOUT" as const } : {}),
      ...(state === "expired" ? { expiresAt: new Date(Date.now() - DAY_MS) } : {}),
    },
  });
  return { sessionId, token };
}

export async function studentWithDevices(schoolId: string, count = 1): Promise<StudentWithDevices> {
  const created = await createStudent(schoolId);
  const devices: Device[] = [];
  for (let i = 0; i < count; i += 1) devices.push(await addDevice(created.user.id));
  return { ...created, devices };
}

export async function pushSchool(): Promise<string> {
  return (await createSchool()).id;
}

/** Satu notifikasi PENDING (siswa) dibuat pada instant `now`; mengembalikan id-nya. */
export async function pendingNotification(userId: string, now: Date = new Date(), title = `Tagihan ${uniq("t")}`): Promise<string> {
  const link = { screen: "invoice", id: uniq("inv") };
  await withTx((tx) => notifyUsers(tx, [userId], { type: "INVOICE_ISSUED", title, body: `Isi ${title}`, link }, { now }));
  const row = await prisma.notification.findFirstOrThrow({ where: { userId, title }, select: { id: true } });
  return row.id;
}

export function jobCtx(now: Date, userIds: readonly string[]): JobContext {
  return { now, requestId: uniq("req"), deadline: Date.now() + 60_000, scope: { userIds } };
}

export const minutesAfter = (base: Date, minutes: number): Date => new Date(base.getTime() + minutes * 60_000);

/** Pesan memory transport milik notifikasi tertentu (transport dipakai bersama seluruh proses). */
export function messagesFor(notificationId: string): PushMessage[] {
  return memoryPushTransport.sent().filter((m) => m.data.notificationId === notificationId);
}

export function notificationRow(id: string) {
  return prisma.notification.findUniqueOrThrow({
    where: { id },
    select: { pushStatus: true, pushAttempts: true, pushNextAttemptAt: true, pushedAt: true, pushError: true },
  });
}
