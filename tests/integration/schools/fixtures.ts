/**
 * Fixture bersama test domain sekolah & pengguna: dua sekolah (IDOR), super admin, admin sekolah,
 * siswa, dan sponsor lengkap dengan token sesi. Semua data unik (aman dijalankan berulang).
 */
import { randomInt } from "node:crypto";
import type { School } from "@prisma/client";
import { createSessionToken } from "../helpers/auth";
import { uniq } from "../helpers/db";
import { createSchool, createSchoolAdmin, createSponsor, createStudent, createSuperAdmin, type TestUser } from "../helpers/factories";

export interface Actor {
  readonly user: TestUser;
  readonly token: string;
}

export interface TwoSchools {
  readonly sa: Actor;
  readonly schoolA: School;
  readonly schoolB: School;
  readonly adminA: Actor;
  readonly adminB: Actor;
  readonly student: Actor;
  readonly sponsor: Actor;
}

export async function actor(user: TestUser): Promise<Actor> {
  const { token } = await createSessionToken(user.id, { platform: "WEB", deviceId: null });
  return { user, token };
}

export async function setupTwoSchools(): Promise<TwoSchools> {
  const [schoolA, schoolB] = await Promise.all([createSchool(), createSchool()]);
  const studentRow = await createStudent(schoolA.id);
  const sponsorRow = await createSponsor();
  return {
    sa: await actor(await createSuperAdmin()),
    schoolA,
    schoolB,
    adminA: await actor(await createSchoolAdmin(schoolA.id)),
    adminB: await actor(await createSchoolAdmin(schoolB.id)),
    student: await actor(studentRow.user),
    sponsor: await actor(sponsorRow.user),
  };
}

/** NPSN 8 digit acak (peluang bentrok sangat kecil). */
export function uniqNpsn(): string {
  return String(randomInt(10_000_000, 100_000_000));
}

/** Body minimal valid untuk POST /platform/schools. */
export function newSchoolBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: `SMP ${uniq("n")}`,
    provinceCode: "32",
    cityCode: "32.73",
    latitude: -6.9147,
    longitude: 107.6098,
    timezone: "WIB",
    ...overrides,
  };
}
