"use client";
import { useEffect, useState } from "react";
import type { RecordDetailDto } from "@/lib/attendance/monitor-schemas";
import { api, scoped } from "@/lib/frontend/api";
import { demoRows } from "@/lib/frontend/demo";
import { demoAttendanceDetail, demoAttendanceMap } from "@/lib/frontend/demo-monitor";
import { useHub } from "../context";
import type { MonitorData } from "./monitor-rules";

/** Pemuatan data halaman kehadiran admin. Mode demo tidak pernah memanggil API. */

export interface ClassOption { readonly id: string; readonly name: string }
export interface MapLoad { readonly data: MonitorData | null; readonly loading: boolean; readonly error: string }

const message = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

function toOptions(rows: unknown): ClassOption[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown) => {
    const item = row as { id?: unknown; name?: unknown } | null;
    return item && typeof item.id === "string" && typeof item.name === "string" ? [{ id: item.id, name: item.name }] : [];
  });
}

/** Daftar kelas untuk filter (GET /school/classes). Gagal -> filter tetap "Semua kelas" + toast. */
export function useClassOptions(enabled: boolean): ClassOption[] {
  const { demo, schoolId, toast } = useHub();
  const [classes, setClasses] = useState<ClassOption[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const load = demo ? Promise.resolve(demoRows("/school/classes")) : api(scoped("/school/classes?limit=100", schoolId)).then(r => r.data);
    load
      .then(rows => { if (active) setClasses(toOptions(rows)); })
      .catch((error: unknown) => { if (active) toast(message(error, "Daftar kelas belum dapat dimuat.")); });
    return () => { active = false; };
  }, [demo, schoolId, enabled, toast]);
  return classes;
}

export interface MapQuery { readonly date: string; readonly classId: string; readonly className: string | null }

/** Peta check-in (GET /school/attendance/map). Data lama dipertahankan saat memuat ulang (peta tidak dibongkar). */
export function useMonitorMap(query: MapQuery, version: number, enabled: boolean): MapLoad {
  const { demo, schoolId } = useHub();
  const [state, setState] = useState<MapLoad>({ data: null, loading: true, error: "" });
  const { date, classId, className } = query;
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const path = `/school/attendance/map?date=${encodeURIComponent(date)}${classId ? `&classId=${encodeURIComponent(classId)}` : ""}`;
    Promise.resolve().then(() => { if (active) setState(s => ({ ...s, loading: true, error: "" })); });
    const load = demo ? Promise.resolve(demoAttendanceMap({ date, className })) : api(scoped(path, schoolId)).then(r => r.data as MonitorData);
    load
      .then(data => { if (active) setState({ data, loading: false, error: "" }); })
      .catch((error: unknown) => { if (active) setState({ data: null, loading: false, error: message(error, "Data kehadiran belum dapat dimuat.") }); });
    return () => { active = false; };
  }, [demo, schoolId, date, classId, className, version, enabled]);
  return state;
}

export interface DetailLoad { readonly data: RecordDetailDto | null; readonly error: string }

/** Detail satu catatan (GET /school/attendance/{id}); demo -> data contoh tanpa permintaan. */
export function useRecordDetail(attendanceId: string, date: string, retry: number): DetailLoad {
  const { demo, schoolId } = useHub();
  const [state, setState] = useState<DetailLoad>({ data: null, error: "" });
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => { if (active) setState({ data: null, error: "" }); });
    const load = demo
      ? Promise.resolve(demoAttendanceDetail(attendanceId, date))
      : api(scoped(`/school/attendance/${encodeURIComponent(attendanceId)}`, schoolId)).then(r => r.data as RecordDetailDto);
    load
      .then(data => { if (active) setState(data ? { data, error: "" } : { data: null, error: "Catatan kehadiran tidak ditemukan." }); })
      .catch((error: unknown) => { if (active) setState({ data: null, error: message(error, "Detail kehadiran belum dapat dimuat.") }); });
    return () => { active = false; };
  }, [attendanceId, date, demo, schoolId, retry]);
  return state;
}
