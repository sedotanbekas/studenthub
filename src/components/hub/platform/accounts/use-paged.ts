"use client";
import { useEffect, useState } from "react";
import { errorText } from "../review-hooks";

export interface Paged<T> {
  readonly rows: T[];
  readonly total: number;
  readonly totalPages: number;
}

/**
 * Daftar bertingkat halaman dengan "Muat lebih banyak". `load` WAJIB stabil (useCallback); ganti filter = pasang ulang
 * komponen pemakai (key) agar halaman kembali ke 1. "loading" diturunkan dari permintaan terakhir yang selesai, jadi
 * tidak ada setState sinkron di dalam effect.
 */
export function usePaged<T>(load: (page: number) => Promise<Paged<T>>, fallbackError: string) {
  // `attempt` membuat permintaan baru untuk halaman yang sama (ulangi setelah gagal).
  const [request, setRequest] = useState({ page: 1, attempt: 0 });
  const [data, setData] = useState<Paged<T>>({ rows: [], total: 0, totalPages: 1 });
  const [done, setDone] = useState<{ load: unknown; request: unknown; error: string }>({ load: null, request: null, error: "" });
  useEffect(() => {
    let active = true;
    load(request.page)
      .then(result => {
        if (!active) return;
        setData(prev => ({ ...result, rows: request.page === 1 ? result.rows : [...prev.rows, ...result.rows] }));
        setDone({ load, request, error: "" });
      })
      .catch(e => { if (active) setDone({ load, request, error: errorText(e, fallbackError) }); });
    return () => { active = false; };
  }, [load, request, fallbackError]);
  const loading = done.load !== load || done.request !== request;
  const failed = !loading && done.error !== "";
  // Halaman yang gagal dimuat diulang, bukan dilompati (barisnya tidak boleh hilang diam-diam).
  const loadMore = () => setRequest(r => (failed ? { page: r.page, attempt: r.attempt + 1 } : { page: r.page + 1, attempt: 0 }));
  return { ...data, loading, error: loading ? "" : done.error, hasMore: failed || request.page < data.totalPages, loadMore };
}
