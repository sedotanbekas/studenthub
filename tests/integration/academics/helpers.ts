/**
 * Pembantu integration test domain akademik & kalender: dua sekolah (IDOR), token per peran,
 * URL dengan ?schoolId=, dan penahan transaksi untuk uji balapan (kunci diambil sebelum membaca).
 */
import { lockKey, withTx } from "@/lib/tx";
import { createSessionToken } from "../helpers/auth";
import { prisma, type Tx } from "../helpers/db";
import { createSchool, createSchoolAdmin, createStudent, createSuperAdmin, type CreateSchoolOptions } from "../helpers/factories";

export interface Tenant {
  readonly schoolId: string;
  readonly adminToken: string;
}

export interface TwoTenants {
  readonly a: Tenant;
  readonly b: Tenant;
  readonly superToken: string;
  /** Siswa AKTIF sekolah A (untuk uji 403 peran). */
  readonly studentToken: string;
}

export async function webToken(userId: string): Promise<string> {
  return (await createSessionToken(userId, { platform: "WEB", deviceId: null })).token;
}

export async function createTenant(options: CreateSchoolOptions = {}): Promise<Tenant> {
  const school = await createSchool(options);
  const admin = await createSchoolAdmin(school.id);
  return { schoolId: school.id, adminToken: await webToken(admin.id) };
}

export async function setupTenants(options: CreateSchoolOptions = {}): Promise<TwoTenants> {
  const [a, b] = [await createTenant(options), await createTenant(options)];
  const superAdmin = await createSuperAdmin();
  const { user } = await createStudent(a.schoolId);
  return { a, b, superToken: await webToken(superAdmin.id), studentToken: (await createSessionToken(user.id)).token };
}

/** Tambahkan ?schoolId= (atau &schoolId=) bila diisi. */
export function withSchool(url: string, schoolId?: string): string {
  if (!schoolId) return url;
  return `${url}${url.includes("?") ? "&" : "?"}schoolId=${encodeURIComponent(schoolId)}`;
}

/** Audit terakhir untuk entitas + aksi (memastikan audit ditulis di transaksi yang sama). */
export function findAudit(entityId: string, action: string) {
  return prisma.auditLog.findFirst({ where: { entityId, action }, orderBy: { createdAt: "desc" } });
}

// ----------------------------------------------------------------------------- uji balapan

/** Jeda agar request paralel sempat mencapai titik tunggunya (kunci/baris) sebelum request berikutnya. */
export const RACE_SETTLE_MS = 400;
const HOLDER_TIMEOUT_MS = 30_000;

export const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface HeldTx {
  /** Commit transaksi penahan lalu tunggu sampai selesai. */
  readonly release: () => Promise<void>;
}

/**
 * Buka transaksi yang menjalankan `during` lalu DITAHAN (kunci/baris tetap terpegang) sampai
 * release(): mensimulasikan mutasi lain yang sedang berjalan di tengah request yang diuji.
 */
export async function holdTx(during: (tx: Tx) => Promise<unknown>): Promise<HeldTx> {
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  let ready: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const done = withTx(
    async (tx) => {
      await during(tx);
      ready();
      await gate;
    },
    { retries: 0, timeout: HOLDER_TIMEOUT_MS },
  );
  await Promise.race([started, done]);
  return {
    release: async () => {
      open();
      await done;
    },
  };
}

/**
 * Tahan kunci aplikasi `key` (lihat src/lib/lock-keys.ts). Baris AppLock dibuat & di-commit dulu
 * agar request yang menunggu antre pada FOR UPDATE, bukan pada INSERT baris baru.
 */
export async function holdLock(key: string, during?: (tx: Tx) => Promise<unknown>): Promise<HeldTx> {
  await withTx((tx) => lockKey(tx, key));
  return holdTx(async (tx) => {
    await lockKey(tx, key);
    await during?.(tx);
  });
}

/** Mulai `requests` berurutan (berjeda) selagi `held` tertahan, lalu lepas dan tunggu semuanya. */
export async function raceWhileHeld<T>(held: HeldTx, requests: ReadonlyArray<() => Promise<T>>): Promise<T[]> {
  const pending: Array<Promise<T>> = [];
  for (const request of requests) {
    pending.push(request());
    await pause(RACE_SETTLE_MS);
  }
  await held.release();
  return Promise.all(pending);
}
