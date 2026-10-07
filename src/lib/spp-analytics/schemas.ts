import { z } from "zod";
import { PERIOD_MONTHS, SCOPE_LEVELS } from "./rules";

/** Skema Analitik SPP per lingkup (2026-10-07). Nominal dalam rupiah (bilangan bulat). */
export const sppAnalyticsQuery = z.object({
  scope: z.enum(SCOPE_LEVELS).default("all").meta({ description: "all = keseluruhan (Admin Pemda: wilayahnya; admin sekolah: sekolahnya), province, city, school." }),
  provinceCode: z.string().regex(/^\d{2}$/, "Kode provinsi harus 2 digit.").optional(),
  cityCode: z.string().regex(/^\d{2}\.\d{2}$/, "Kode kabupaten/kota berformat 00.00.").optional(),
  schoolId: z.string().trim().min(1).max(64).optional(),
  months: z
    .enum(PERIOD_MONTHS.map(String) as ["3", "6", "12"])
    .default("6")
    .transform(Number)
    .meta({ description: "Jumlah bulan tagihan (periode SPP) yang dihitung, berakhir bulan berjalan." }),
});
export type SppAnalyticsQuery = z.output<typeof sppAnalyticsQuery>;

const bucket = z.object({ count: z.number().int(), amount: z.number().int() });
const buckets = {
  onTime: bucket.meta({ description: "Lunas tepat waktu (tanggal lunas <= jatuh tempo); amount = nominal tagihan." }),
  late: bucket.meta({ description: "Lunas TELAT (tanggal lunas > jatuh tempo); amount = nominal tagihan." }),
  overdue: bucket.meta({ description: "Belum lunas & sudah lewat jatuh tempo (menunggak); amount = sisa tagihan." }),
  notDue: bucket.meta({ description: "Belum lunas & belum jatuh tempo; amount = sisa tagihan." }),
  billed: z.number().int().meta({ description: "Total nominal tagihan (tanpa yang dibatalkan)." }),
  paid: z.number().int().meta({ description: "Total terbayar (termasuk cicilan)." }),
  outstanding: z.number().int(),
  collectionRate: z.number().nullable().meta({ description: "Persen terbayar dari tertagih." }),
};

export const sppAnalyticsSchema = z
  .object({
    scope: z.object({
      level: z.enum(SCOPE_LEVELS),
      label: z.string(),
      provinceCode: z.string().nullable(),
      cityCode: z.string().nullable(),
      schoolId: z.string().nullable(),
      childLevel: z.enum(["province", "city", "school", "class"]),
    }),
    period: z.object({ from: z.string(), to: z.string(), months: z.number().int() }),
    asOf: z.string().meta({ description: "Tanggal acuan jatuh tempo (WIB; sekolah WITA/WIT memakai tanggal lokalnya)." }),
    totals: z.object({
      ...buckets,
      invoices: z.number().int(),
      students: z.number().int(),
      overdueStudents: z.number().int().meta({ description: "Siswa yang punya tagihan menunggak." }),
      lateStudents: z.number().int().meta({ description: "Siswa yang pernah melunasi dengan telat pada periode ini." }),
    }),
    trend: z.array(z.object({ period: z.string(), ...buckets })),
    breakdown: z.array(z.object({ key: z.string(), label: z.string(), ...buckets, students: z.number().int(), overdueStudents: z.number().int() })),
    students: z
      .array(
        z.object({
          studentId: z.string(),
          name: z.string(),
          nisn: z.string(),
          className: z.string().nullable(),
          schoolName: z.string(),
          overdueInvoices: z.number().int(),
          outstanding: z.number().int(),
          oldestDueDate: z.string().nullable(),
          lateInvoices: z.number().int(),
        }),
      )
      .meta({ description: "Paling banyak 50 siswa menunggak / pernah telat, urut sisa tunggakan terbesar." }),
  })
  .meta({ id: "SppAnalytics" });
export type SppAnalyticsDto = z.input<typeof sppAnalyticsSchema>;
