import type { ClickBilling, DeviceType } from "@prisma/client";
import { NEW_STUDENT_MIN_AGE_DAYS, type REPORTED_DEVICE_TYPES } from "./constants";

/**
 * Keputusan penagihan klik (murni). Setiap klik dicatat; hanya CHARGED yang memotong saldo.
 * Urutan: iklan tidak berjalan -> sudah ditagih hari ini (WIB) -> mencurigakan (tanpa impresi 30 menit
 * sebelumnya ATAU akun siswa aktif < 7 hari) -> saldo kurang dari CPC -> ditagih.
 */
export interface ClickFacts {
  /** Iklan APPROVED, dalam jadwal, sponsor APPROVED, dan target cocok dengan sekolah siswa. */
  readonly running: boolean;
  /** Sudah ada klik CHARGED siswa ini untuk iklan ini pada hari WIB yang sama. */
  readonly billedToday: boolean;
  /** Ada impresi siswa ini untuk iklan ini dalam 30 menit sebelum klik. */
  readonly recentImpression: boolean;
  readonly newStudent: boolean;
  readonly balance: number;
  readonly cpc: number;
}

export function classifyClick(f: ClickFacts): ClickBilling {
  if (!f.running) return "AD_NOT_LIVE";
  if (f.billedToday) return "DUPLICATE";
  if (!f.recentImpression || f.newStudent) return "SUSPECT";
  if (f.balance < f.cpc) return "INSUFFICIENT_BALANCE";
  return "CHARGED";
}

const DAY_MS = 86_400_000;

/** Akun siswa belum pernah aktif atau aktif kurang dari 7 hari (anti akun palsu penguras saldo). */
export function isNewStudent(activatedAt: Date | null, now: Date): boolean {
  if (!activatedAt) return true;
  return now.getTime() - activatedAt.getTime() < NEW_STUDENT_MIN_AGE_DAYS * DAY_MS;
}

const DEVICE_MAP: Readonly<Record<(typeof REPORTED_DEVICE_TYPES)[number], DeviceType>> = {
  MOBILE: "MOBILE", PHONE: "MOBILE", UNKNOWN: "MOBILE", TABLET: "TABLET", DESKTOP: "DESKTOP", TV: "DESKTOP",
};

/** Normalisasi jenis perangkat laporan app (expo-device: PHONE/TABLET/DESKTOP/TV/UNKNOWN) ke enum DeviceType. */
export function mapDeviceType(value: (typeof REPORTED_DEVICE_TYPES)[number]): DeviceType {
  return DEVICE_MAP[value];
}
