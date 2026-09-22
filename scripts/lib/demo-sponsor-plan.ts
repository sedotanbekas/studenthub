/**
 * Rencana murni data demo sponsor & iklan (tanpa I/O, diuji unit): akun sponsor, dua iklan, lini masa
 * (top-up -> iklan disetujui -> trafik 14 hari terakhir), pola impresi & klik deterministik per hari.
 * Penulisan lewat service domain ada di demo-sponsor.ts.
 */
import type { DeviceType } from "@prisma/client";
import { DEMO_EMAIL_DOMAIN } from "./demo-data";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const DEMO_SPONSOR = {
  companyName: "PT Mitra Belajar Demo",
  contactName: "Rina Kemitraan",
  email: `sponsor@${DEMO_EMAIL_DOMAIN}`,
  phone: "+6281311112222",
  loginName: "Sponsor Demo",
} as const;

export const DEMO_TOPUP_AMOUNT = 2_000_000;
export const DEMO_PENDING_TOPUP_AMOUNT = 500_000;
export const DEMO_TRAFFIC_DAYS = 14;
/** Siswa demo per hari yang dipertimbangkan sebagai pengeklik (indeks siswa gabungan kedua sekolah). */
const CLICK_POOL = 30;

export interface DemoAdSpec {
  readonly title: string;
  readonly targetUrl: string;
  /** ALL, atau PROVINCE provinsi sekolah demo pertama. */
  readonly scope: "ALL" | "FIRST_SCHOOL_PROVINCE";
  /** Warna dasar banner sintetis. */
  readonly rgb: readonly [number, number, number];
}

export const DEMO_ADS: readonly DemoAdSpec[] = [
  { title: "Bimbel Online Gratis Sebulan (demo)", targetUrl: "https://example.com/demo/bimbel", scope: "ALL", rgb: [30, 110, 200] },
  { title: "Diskon Alat Tulis Awal Semester (demo)", targetUrl: "https://example.com/demo/alat-tulis", scope: "FIRST_SCHOOL_PROVINCE", rgb: [220, 120, 30] },
];

export interface DemoSponsorTimeline {
  readonly topUpAt: Date;
  readonly topUpApprovedAt: Date;
  readonly adCreatedAt: Date;
  readonly adApprovedAt: Date;
  readonly adStartAt: Date;
  readonly adEndAt: Date;
}

/** Semua instan dimundurkan relatif `now` agar trafik 14 hari terakhir sah (iklan sudah tayang & bersaldo). */
export function demoSponsorTimeline(now: Date): DemoSponsorTimeline {
  const base = now.getTime() - (DEMO_TRAFFIC_DAYS + 2) * DAY;
  return {
    topUpAt: new Date(base),
    topUpApprovedAt: new Date(base + HOUR),
    adCreatedAt: new Date(base + 2 * HOUR),
    adApprovedAt: new Date(base + 3 * HOUR),
    adStartAt: new Date(base + 3 * HOUR),
    adEndAt: new Date(now.getTime() + 90 * DAY),
  };
}

export interface DemoTrafficDay {
  /** Instan kejadian (10.00 WIB hari itu). */
  readonly at: Date;
  readonly impressions: number;
  /** Indeks siswa demo (0..29) yang mengklik iklan hari itu (unik). */
  readonly clickerIndexes: readonly number[];
}

const WIB_TEN_AM_UTC_HOUR = 3;

/** Trafik iklan ke-`adIndex` untuk hari (now - 14) .. (now - 1), jam 10.00 WIB. */
export function demoAdTraffic(now: Date, adIndex: number): DemoTrafficDay[] {
  return Array.from({ length: DEMO_TRAFFIC_DAYS }, (_, i) => {
    const daysAgo = DEMO_TRAFFIC_DAYS - i;
    const day = new Date(now.getTime() - daysAgo * DAY);
    const at = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), WIB_TEN_AM_UTC_HOUR));
    const clickerIndexes = Array.from({ length: CLICK_POOL }, (_, s) => s).filter((s) => (s * 7 + i * 3 + adIndex * 5) % 11 === 0);
    return { at, impressions: 25 + ((i * 13 + adIndex * 7) % 20), clickerIndexes };
  });
}

export function demoDeviceType(studentIndex: number): DeviceType {
  return studentIndex % 5 === 3 ? "TABLET" : "MOBILE";
}
