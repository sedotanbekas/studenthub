import type { ActionContext } from "@/lib/auth/principal";
import type { Tx } from "@/lib/db";
import type { LocalDate } from "@/lib/time/zone";

/**
 * Perubahan kalender (libur sekolah/nasional) yang memengaruhi data absensi.
 * schoolId NULL = libur nasional (berlaku untuk semua sekolah).
 * ADDED   = rentang menjadi hari libur; REMOVED = libur dihapus;
 * CHANGED = libur diubah (from/to = gabungan rentang lama dan baru).
 */
export interface CalendarChange {
  readonly schoolId: string | null;
  readonly from: LocalDate;
  readonly to: LocalDate;
  readonly kind: "ADDED" | "REMOVED" | "CHANGED";
}

/**
 * Dipanggil domain kalender DI DALAM transaksi yang sama dengan penulisan libur.
 *
 * STUB P1: belum ada data absensi yang perlu disinkronkan. Fase P2 (absensi) mengimplementasikan
 * aturan docs/design/02-attendance.md §3.8.6: libur ditambah -> baris AUTO_ALPHA/LEAVE di rentang
 * dibatalkan; libur dihapus/dipersempit -> JobRun auto-alpha dalam jendela lookback dibuka ulang;
 * libur nasional berlaku lintas sekolah. Kembalikan jumlah baris yang terdampak.
 */
export async function onCalendarChanged(_tx: Tx, _change: CalendarChange, _ctx: ActionContext): Promise<{ affected: number }> {
  return { affected: 0 };
}
