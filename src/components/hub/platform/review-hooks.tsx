"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/frontend/api";
import { applyPatches, matchesSearch, mergeById, normalizeSearch } from "@/lib/frontend/review-rules";
import { useHub } from "../context";

/**
 * Pemuatan data halaman peninjauan super admin (moderasi iklan & verifikasi top-up).
 * Mode demo tidak pernah memanggil API: data contoh + keputusan disimulasikan sebagai "patch" lokal,
 * dan pencarian menyaring data contoh secara lokal.
 */

/** Layar cukup lebar untuk daftar + detail berdampingan; di bawahnya detail dibuka sebagai sheet. */
export const SPLIT_QUERY = "(min-width: 1200px)";
/** Baris per halaman antrean; "Muat lebih banyak" mengambil halaman berikutnya. */
export const QUEUE_LIMIT = 50;
/** Jeda ketik sebelum pencarian dikirim ke server. */
export const SEARCH_DEBOUNCE_MS = 300;

export const errorText = (error: unknown, fallback: string): string => (error instanceof Error && error.message ? error.message : fallback);

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((notify: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener("change", notify);
    return () => media.removeEventListener("change", notify);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

interface QueueItem { readonly id: string; readonly status: string }

export interface ReviewQueue<T> {
  readonly items: T[];
  /** Jumlah total item pada tab ini (server, sesuai pencarian), dikurangi yang baru diputuskan. */
  readonly total: number;
  /** Jumlah yang menunggu keputusan (untuk label tab); null bila belum diketahui. */
  readonly pending: number | null;
  readonly loading: boolean;
  readonly error: string;
  readonly reload: () => void;
  /** Catat keputusan: item langsung pindah tab (patch lokal), lalu daftar dimuat ulang dari server. */
  readonly settle: (id: string, patch: Partial<T>) => void;
  /** Masih ada halaman berikutnya di server. */
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly moreError: string;
  readonly loadMore: () => void;
}

export interface QueueSource<T> {
  readonly path: string;
  readonly status: string;
  readonly pendingStatus: string;
  /** Kata kunci pencarian yang sudah dinormalisasi; "" = tanpa pencarian. */
  readonly query: string;
  readonly demoAll: () => T[];
  /** Teks yang dicari di mode demo (mis. judul iklan). */
  readonly searchText?: (item: T) => string;
}

// ----------------------------------------------------------------------------- pengambilan halaman

interface PageResult<T> { readonly rows: T[]; readonly total: number; readonly totalPages: number }

function listUrl(path: string, status: string, query: string, page: number): string {
  const params = new URLSearchParams({ status, page: String(page), limit: String(QUEUE_LIMIT) });
  if (query) params.set("q", query);
  return `${path}?${params.toString()}`;
}

async function fetchPage<T>(path: string, status: string, query: string, page: number): Promise<PageResult<T>> {
  const result = await api(listUrl(path, status, query, page));
  const rows = Array.isArray(result.data) ? result.data as T[] : [];
  const total = result.meta?.total ?? rows.length;
  return { rows, total, totalPages: result.meta?.totalPages ?? Math.max(1, Math.ceil(total / QUEUE_LIMIT)) };
}

/** Muat ulang halaman 1..pages sekaligus agar potret daftar konsisten setelah keputusan. */
async function fetchPages<T extends QueueItem>(path: string, status: string, query: string, pages: number): Promise<PageResult<T>> {
  const results = await Promise.all(Array.from({ length: pages }, (_, index) => fetchPage<T>(path, status, query, index + 1)));
  const first = results[0];
  return { rows: results.reduce<T[]>((all, result) => mergeById(all, result.rows), []), total: first?.total ?? 0, totalPages: first?.totalPages ?? 1 };
}

async function fetchPendingCount(path: string, pendingStatus: string): Promise<number | null> {
  try {
    return (await api(`${path}?status=${pendingStatus}&limit=1`)).meta?.total ?? null;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------- antrean server

interface Remote<T> {
  /** `status|query` milik data ini; beda dengan yang diminta = masih memuat tab/pencarian baru. */
  readonly key: string;
  readonly rows: T[];
  readonly total: number;
  readonly totalPages: number;
  readonly pages: number;
  readonly pending: number | null;
  readonly loading: boolean;
  readonly error: string;
}
interface MoreState { readonly key: string; readonly loading: boolean; readonly error: string }

const EMPTY_REMOTE: Remote<never> = { key: "", rows: [], total: 0, totalPages: 1, pages: 1, pending: null, loading: true, error: "" };
const IDLE_MORE: MoreState = { key: "", loading: false, error: "" };

interface RemoteQueue<T> { readonly remote: Remote<T>; readonly key: string; readonly more: MoreState; readonly loadMore: () => void }

function useRemoteQueue<T extends QueueItem>(source: QueueSource<T>, version: number, onFresh: () => void): RemoteQueue<T> {
  const { demo } = useHub();
  const { path, status, pendingStatus, query } = source;
  const key = `${status}|${query}`;
  const [remote, setRemote] = useState<Remote<T>>(EMPTY_REMOTE);
  const [more, setMore] = useState<MoreState>(IDLE_MORE);
  /** Naik setiap muat ulang; hasil "muat lebih banyak" dari generasi lama dibuang. */
  const generation = useRef(0);
  const loaded = useRef({ key: "", pages: 1 });
  useEffect(() => {
    if (demo) return;
    let active = true;
    generation.current += 1;
    const pages = loaded.current.key === key ? loaded.current.pages : 1;
    const ownCount = status === pendingStatus && !query;
    Promise.resolve().then(() => { if (active) setRemote(s => ({ ...s, loading: true, error: "" })); });
    Promise.all([fetchPages<T>(path, status, query, pages), ownCount ? null : fetchPendingCount(path, pendingStatus)])
      .then(([page, counted]) => {
        if (!active) return;
        loaded.current = { key, pages };
        setRemote({ key, ...page, pages, pending: ownCount ? page.total : counted, loading: false, error: "" });
        onFresh();
      })
      .catch((error: unknown) => { if (active) setRemote({ ...EMPTY_REMOTE, key, loading: false, error: errorText(error, "Antrean belum dapat dimuat.") }); });
    return () => { active = false; };
  }, [demo, path, status, pendingStatus, query, key, version, onFresh]);
  const loadMore = useLoadMore({ path, status, query, key, remote, generation, loaded, setRemote, setMore });
  return { remote, key, more, loadMore };
}

interface LoadMoreDeps<T> {
  readonly path: string;
  readonly status: string;
  readonly query: string;
  readonly key: string;
  readonly remote: Remote<T>;
  readonly generation: { current: number };
  readonly loaded: { current: { key: string; pages: number } };
  readonly setRemote: (update: (current: Remote<T>) => Remote<T>) => void;
  readonly setMore: (next: MoreState) => void;
}

/** Ambil halaman berikutnya lalu gabungkan (id ganda dibuang) ke daftar yang sudah tampil. */
function useLoadMore<T extends QueueItem>({ path, status, query, key, remote, generation, loaded, setRemote, setMore }: LoadMoreDeps<T>): () => void {
  const { key: remoteKey, pages } = remote;
  return useCallback(() => {
    if (remoteKey !== key) return;
    const run = generation.current;
    const page = pages + 1;
    setMore({ key, loading: true, error: "" });
    fetchPage<T>(path, status, query, page).then(
      next => {
        if (generation.current === run) {
          loaded.current = { key, pages: page };
          setRemote(s => (s.key === key ? { ...s, rows: mergeById(s.rows, next.rows), total: next.total, totalPages: next.totalPages, pages: page } : s));
        }
        setMore({ key, loading: false, error: "" });
      },
      (error: unknown) => setMore({ key, loading: false, error: generation.current === run ? errorText(error, "Halaman berikutnya belum dapat dimuat.") : "" }),
    );
  }, [remoteKey, key, pages, generation, loaded, path, status, query, setRemote, setMore]);
}

// ----------------------------------------------------------------------------- antrean + keputusan lokal

const noop = () => undefined;

/** Antrean satu tab status (+ pencarian) dan jumlah yang menunggu; keputusan lokal langsung terlihat. */
export function useReviewQueue<T extends QueueItem>(source: QueueSource<T>): ReviewQueue<T> {
  const { demo } = useHub();
  const [patches, setPatches] = useState<Readonly<Record<string, Partial<T>>>>({});
  const [version, setVersion] = useState(0);
  const clearPatches = useCallback(() => setPatches({}), []);
  const { remote, key, more, loadMore } = useRemoteQueue(source, version, clearPatches);
  const { demoAll, status, pendingStatus, query, searchText } = source;
  const all = useMemo(() => (demo ? demoAll() : []), [demo, demoAll]);
  const reload = useCallback(() => setVersion(v => v + 1), []);
  const settle = useCallback((id: string, patch: Partial<T>) => {
    setPatches(p => ({ ...p, [id]: { ...p[id], ...patch } }));
    if (!demo) setVersion(v => v + 1);
  }, [demo]);
  return useMemo(() => {
    const actions = { reload, settle };
    if (demo) {
      const items = applyPatches(all, patches, status).filter(item => !searchText || matchesSearch(searchText(item), query));
      const pending = applyPatches(all, patches, pendingStatus).length;
      return { ...actions, items, total: items.length, pending, loading: false, error: "", hasMore: false, loadingMore: false, moreError: "", loadMore: noop };
    }
    return { ...actions, ...liveView(remote, patches, key, status, pendingStatus), loadMore, ...moreView(more, key) };
  }, [demo, all, patches, status, pendingStatus, query, searchText, remote, key, more, loadMore, reload, settle]);
}

function liveView<T extends QueueItem>(remote: Remote<T>, patches: Readonly<Record<string, Partial<T>>>, key: string, status: string, pendingStatus: string) {
  // Tab/pencarian baru belum dimuat: tampilkan pemuatan, bukan baris milik tab/pencarian lama.
  const fresh = remote.key === key;
  const rows = fresh ? remote.rows : [];
  const items = applyPatches(rows, patches, status);
  const decided = rows.length - items.length;
  // Jumlah menunggu tidak bergantung tab, jadi label tab tetap tampil selama tab lain dimuat.
  const pending = remote.pending === null ? null : Math.max(0, remote.pending - (status === pendingStatus ? decided : 0));
  return {
    items, pending, total: fresh ? Math.max(0, remote.total - decided) : 0, loading: remote.loading || !fresh,
    error: fresh ? remote.error : "", hasMore: fresh && !remote.error && remote.pages < remote.totalPages,
  };
}

function moreView(more: MoreState, key: string) {
  const current = more.key === key;
  return { loadingMore: current && more.loading, moreError: current ? more.error : "" };
}

// ----------------------------------------------------------------------------- pencarian

export interface QueueSearch {
  /** Isi kolom pencarian apa adanya. */
  readonly text: string;
  /** Kata kunci terkirim (dinormalisasi, setelah jeda ketik). */
  readonly query: string;
  readonly change: (text: string) => void;
  readonly clear: () => void;
}

/** Kolom pencarian dengan jeda ketik: permintaan baru dikirim 300 ms setelah berhenti mengetik. */
export function useQueueSearch(delay: number = SEARCH_DEBOUNCE_MS): QueueSearch {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const pending = timer;
    return () => clearTimeout(pending.current);
  }, []);
  const change = useCallback((next: string) => {
    setText(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setQuery(normalizeSearch(next)), delay);
  }, [delay]);
  const clear = useCallback(() => {
    clearTimeout(timer.current);
    setText("");
    setQuery("");
  }, []);
  return useMemo(() => ({ text, query, change, clear }), [text, query, change, clear]);
}

// ----------------------------------------------------------------------------- detail

export interface RemoteDetail<T> { readonly data: T | null; readonly error: string; readonly loading: boolean }

/** Detail terbaru dari server (null path = tidak memuat, mis. mode demo). Data lama tidak dipakai untuk id lain. */
export function useRemoteDetail<T>(path: string | null, version: number): RemoteDetail<T> {
  const [state, setState] = useState<{ key: string; data: T | null; error: string }>({ key: "", data: null, error: "" });
  const key = path ? `${path}#${version}` : "";
  useEffect(() => {
    if (!path) return;
    let active = true;
    const current = `${path}#${version}`;
    api(path)
      .then(result => { if (active) setState({ key: current, data: result.data as T, error: "" }); })
      .catch((error: unknown) => { if (active) setState({ key: current, data: null, error: errorText(error, "Detail belum dapat dimuat.") }); });
    return () => { active = false; };
  }, [path, version]);
  const fresh = key !== "" && state.key === key;
  return { data: fresh ? state.data : null, error: fresh ? state.error : "", loading: key !== "" && !fresh };
}
