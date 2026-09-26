"use client";
import { useEffect, useState } from "react";
import { api, scoped } from "@/lib/frontend/api";
import { demoAnalyticsRows } from "@/lib/frontend/demo-analytics";
import { useHub } from "../context";

/** Status muat satu panel grafik: panel lain tetap tampil bila satu gagal. */
export type Load<T> = { readonly status: "loading" } | { readonly status: "error"; readonly message: string } | { readonly status: "ready"; readonly data: T };

const UNREADABLE = "Data grafik tidak dapat dibaca. Coba muat ulang.";

/**
 * Memuat satu endpoint analitik absensi (/school/attendance/analytics/*). Mode demo memakai data
 * contoh bentuk persis tanpa request; SUPER_ADMIN dibungkus `scoped`. `guard` = modul-level (stabil).
 */
export function useAnalytics<T>(path: string, guard: (value: unknown) => value is T): { state: Load<T>; retry: () => void } {
  const { demo, schoolId } = useHub();
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const request = demo ? Promise.resolve(demoAnalyticsRows(path)) : api(scoped(path, schoolId)).then(r => r.data);
    request
      .then(data => { if (active) setState(guard(data) ? { status: "ready", data } : { status: "error", message: UNREADABLE }); })
      .catch((e: unknown) => { if (active) setState({ status: "error", message: e instanceof Error ? e.message : UNREADABLE }); });
    return () => { active = false; };
  }, [path, guard, demo, schoolId, attempt]);
  const retry = () => { setState({ status: "loading" }); setAttempt(n => n + 1); };
  return { state, retry };
}
