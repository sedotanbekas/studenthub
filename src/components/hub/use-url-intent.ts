"use client";
import { useCallback, useEffect } from "react";
import { operations } from "@/lib/frontend/catalog";
import { searchDate } from "@/lib/frontend/notification-cta";
import type { Operation, Row } from "@/lib/frontend/types";
import type { LocalDate } from "@/lib/time/zone";
import { afterPageSlide } from "./page-slide";

/** Buang satu parameter dari URL tanpa navigasi (riwayat tetap satu entri). */
function stripParam(key: string): void {
  const params = new URLSearchParams(window.location.search);
  params.delete(key);
  const rest = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
}

/**
 * Intent URL bertanggal dari tombol notifikasi (N4): `?ajukan=` (formulir izin/sakit terisi) dan `?tanggal=` (peta
 * kehadiran pada tanggal itu). Dijalankan setelah transisi halaman selesai; parameter baru dibuang saat intent
 * benar-benar dijalankan (efek ganda StrictMode tidak menghilangkannya). `apply` wajib stabil (useCallback);
 * null = halaman ini tidak menangani intent tersebut. Nilai yang bukan tanggal sah dibuang tanpa tindakan.
 */
export function useUrlDateIntent(key: string, apply: ((date: LocalDate) => void) | null): void {
  useEffect(() => {
    if (!apply || !new URLSearchParams(window.location.search).has(key)) return;
    const date = searchDate(window.location.search, key);
    if (!date) { stripParam(key); return; }
    return afterPageSlide(() => { stripParam(key); apply(date); });
  }, [key, apply]);
}

const LEAVE_OP = operations.find(op => op.id === "createOwnLeaveRequest");

/**
 * `?ajukan=YYYY-MM-DD` di Izin & sakit (tombol notifikasi Alpa): formulir pengajuan dengan tanggal mulai & selesai
 * terisi. Server tetap memeriksa batas mundur & tumpang-tindih (LEAVE_BACKDATE_LIMIT / LEAVE_OVERLAP).
 */
export function useLeaveIntent(enabled: boolean, open: (action: { op: Operation; initial: Row }) => void): void {
  const apply = useCallback((date: LocalDate) => { if (LEAVE_OP) open({ op: LEAVE_OP, initial: { startDate: date, endDate: date } }); }, [open]);
  useUrlDateIntent("ajukan", enabled && LEAVE_OP ? apply : null);
}
