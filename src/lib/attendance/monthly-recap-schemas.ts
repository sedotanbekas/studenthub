import type { StudentStatus } from "@prisma/client";
import { z } from "zod";
import { DAY_REASONS } from "@/lib/calendar/rules";
import { lateReasonCountsSchema } from "./late-reason-schemas";
import { dateOut, idString, monitorScopeQuery, monthField, monthOut } from "./monitor-schemas";
import { DAY_CLOSURES, RECAP_CODES } from "./monthly-recap-rules";

/** Skema zod rekap bulanan per kelas + ekspor Excel (A3). NISN tidak pernah ada di respons maupun berkas. */

const STUDENT_STATUSES = ["DRAFT", "ACTIVE", "INACTIVE", "GRADUATED", "MOVED"] as const satisfies readonly StudentStatus[];

export const monthlyRecapQuery = monitorScopeQuery.extend({
  classId: idString.meta({ description: "Kelas (snapshot kelas saat absen dicatat). Kelas sekolah lain -> 404." }),
  month: monthField,
});
export type MonthlyRecapQuery = z.infer<typeof monthlyRecapQuery>;

export const monthlyRecapExportQuery = monitorScopeQuery.extend({
  classId: idString.optional().meta({ description: "Kosong = semua kelas (satu sheet per kelas, termasuk 'Tanpa kelas' bila ada)." }),
  month: monthField,
});
export type MonthlyRecapExportQuery = z.infer<typeof monthlyRecapExportQuery>;

const count = z.int().min(0);

export const attendanceTallySchema = z
  .object({
    hadir: count,
    terlambat: count,
    izin: count,
    sakit: count,
    alpha: count,
    recorded: count.meta({ description: "Hari tercatat (s.d. closedThrough)." }),
    present: count.meta({ description: "Hadir + terlambat." }),
    presentPct: z.number().nullable().meta({ description: "present / recorded (satu desimal); null bila belum ada hari tercatat." }),
    lateMinutes: count.meta({ description: "Total menit terlambat." }),
    lateReasons: lateReasonCountsSchema.omit({ from: true, to: true }).meta({ description: "Alasan terlambat per kategori (aturan A1: belum diisi = check-in sendiri tanpa alasan)." }),
  })
  .meta({ id: "AttendanceTally" });
export type AttendanceTallyDto = z.infer<typeof attendanceTallySchema>;

const recapDaySchema = z.object({
  date: dateOut,
  day: z.int().min(1).max(31),
  weekday: z.int().min(1).max(7).meta({ description: "1 = Senin ... 7 = Minggu." }),
  reason: z.enum(DAY_REASONS),
  holidayName: z.string().nullable(),
  closure: z.enum(DAY_CLOSURES).meta({ description: "CLOSED = final; UNCLOSED = tertutup tapi alpa otomatis belum ditulis (angka bisa bertambah); OPEN = hari berjalan / mendatang (tidak dihitung)." }),
});

const recapStudentSchema = z.object({
  studentId: z.string(),
  name: z.string(),
  nis: z.string(),
  studentStatus: z.enum(STUDENT_STATUSES),
  cells: z.array(z.enum(RECAP_CODES).nullable()).meta({ description: "Satu kode per tanggal (urut days): H/T/I/S/A, K = tercatat di kelas lain, null = tanpa catatan." }),
  otherClasses: z.array(z.object({ id: z.string().nullable(), name: z.string() })).meta({ description: "Kelas lain tempat siswa tercatat bulan ini (pindah kelas); id null = tanpa kelas." }),
  totals: attendanceTallySchema,
});

export const monthlyRecapSchema = z
  .object({
    month: monthOut,
    monthLabel: z.string().meta({ example: "September 2026" }),
    class: z.object({ id: z.string(), name: z.string() }),
    closedThrough: dateOut.meta({ description: "Hari terakhir yang dihitung (lewat jam akhir hari sekolah)." }),
    isFinal: z.boolean().meta({ description: "true bila seluruh bulan sudah lewat dan tidak ada hari yang belum ditutup." }),
    unclosedDates: z.array(dateOut),
    days: z.array(recapDaySchema),
    students: z.array(recapStudentSchema),
    totals: attendanceTallySchema,
  })
  .meta({ id: "MonitorMonthlyRecap" });
export type MonthlyRecapDto = z.infer<typeof monthlyRecapSchema>;
