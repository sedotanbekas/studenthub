import { z } from "zod";
import { entityIdSchema, schoolIdQuery } from "@/lib/academics/schema-common";
import { todayStatsSchema } from "@/lib/attendance/monitor-schemas";

/** Skema zod ringkasan dashboard admin sekolah: masukan query + keluaran (kontrak & OpenAPI). */

export const dashboardSummaryQuery = schoolIdQuery.extend({
  termId: entityIdSchema
    .optional()
    .meta({ description: "Semester untuk kartu rapor; default semester aktif sekolah. Semester sekolah lain -> 404." }),
});
export type DashboardSummaryQuery = z.output<typeof dashboardSummaryQuery>;

const count = (description: string) => z.int().min(0).meta({ description });
const rupiah = (description: string) => z.number().min(0).meta({ description: `${description} (rupiah).` });

export const studentCountsSchema = z
  .object({
    active: count("Siswa AKTIF."),
    inactive: count("Siswa NONAKTIF."),
    draft: count("Siswa DRAFT (belum diaktifkan)."),
    graduated: count("Siswa LULUS."),
    moved: count("Siswa PINDAH."),
  })
  .meta({ id: "DashboardStudentCounts" });

export const reportCardSummarySchema = z
  .object({
    term: z.object({ id: z.string(), label: z.string() }).nullable().meta({ description: "null bila termId kosong dan sekolah belum punya semester aktif." }),
    activeStudents: count("Siswa AKTIF."),
    studentsWithGrades: count("Siswa AKTIF dengan rapor semester ini yang memiliki >= 1 nilai."),
    studentsComplete: count("Siswa AKTIF dengan rapor TERBIT, atau DRAFT yang semua mapel kelasnya sudah dinilai."),
    published: count("Siswa AKTIF dengan rapor TERBIT."),
  })
  .meta({ id: "DashboardReportCardStats" });

export const billingPeriodSummarySchema = z
  .object({
    periodYear: z.int(),
    periodMonth: z.int().min(1).max(12),
    invoiced: count("Tagihan tidak dibatalkan (paid + partial + unpaid)."),
    paid: count("Tagihan LUNAS."),
    partial: count("Tagihan SEBAGIAN."),
    unpaid: count("Tagihan BELUM BAYAR."),
    void: count("Tagihan DIBATALKAN."),
    billedAmount: rupiah("Total nominal tagihan tidak dibatalkan"),
    collectedAmount: rupiah("Total terbayar"),
  })
  .meta({ id: "DashboardBillingPeriod" });

export const billingSummarySchema = z
  .object({
    studentsNotFullyPaid: count("Siswa AKTIF dengan tagihan BELUM BAYAR/SEBAGIAN berperiode <= bulan ini atau sudah lewat jatuh tempo."),
    studentsOverdue: count("Bagian dari itu yang punya tagihan lewat jatuh tempo."),
    outstandingAmount: rupiah("Total sisa tagihan tersebut"),
    pendingVerification: count("Bukti transfer menunggu verifikasi."),
    period: billingPeriodSummarySchema.nullable().meta({ description: "Rekap tagihan bulan berjalan (waktu lokal sekolah)." }),
  })
  .meta({ id: "DashboardBillingStats" });

export const dashboardSummarySchema = z
  .object({
    students: studentCountsSchema,
    attendanceToday: todayStatsSchema,
    reportCards: reportCardSummarySchema,
    billing: billingSummarySchema,
  })
  .meta({ id: "DashboardSummary" });
export type DashboardSummaryDto = z.input<typeof dashboardSummarySchema>;
export type StudentCountsDto = z.input<typeof studentCountsSchema>;
