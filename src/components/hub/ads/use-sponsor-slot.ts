"use client";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ApiError, api } from "@/lib/frontend/api";
import type { AdClickResult, ServedAd, ServedAds } from "@/lib/frontend/ad-types";
import { IMPRESSION_FLUSH_MS, ROTATE_MS, VISIBLE_MS, VISIBLE_RATIO, deviceTypeOf, enqueueImpression, isRetryableImpressionError, refreshDelaySeconds, safeTargetUrl, takeBatch, wrapIndex } from "@/lib/frontend/ad-slot-rules";
import { demoServedAds } from "@/lib/frontend/demo-ads";

/** Hook slot iklan beranda siswa: muat iklan, catat impresi & klik (mode demo: tanpa request). */

/**
 * Iklan yang boleh tayang untuk siswa ini. Muat awal gagal -> [] (slot disembunyikan); muat ulang gagal
 * -> kartu yang sudah tampil dipertahankan (token berlaku 6 jam). Setelah gagal dicoba lagi bertahap.
 */
export function useServedAds(demo: boolean) {
  const [ads, setAds] = useState<readonly ServedAd[] | null>(null);
  const [version, setVersion] = useState(0);
  const failures = useRef(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (seconds: number) => { timer = setTimeout(() => setVersion(v => v + 1), seconds * 1000); };
    const load = demo ? Promise.resolve(demoServedAds()) : api("/student/ads").then(r => r.data as ServedAds);
    load.then(result => {
      if (!active) return;
      failures.current = 0;
      setAds(result.ads);
      schedule(refreshDelaySeconds(result.refreshAfterSeconds, 0));
    }).catch(() => {
      if (!active) return;
      failures.current += 1;
      setAds(prev => prev ?? []);
      schedule(refreshDelaySeconds(null, failures.current));
    });
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [demo, version]);
  const reload = useCallback(() => setVersion(v => v + 1), []);
  return { ads, reload };
}

const IMPRESSIONS_PATH = "/student/ads/impressions";
const impressionBody = (tokens: readonly string[]) => JSON.stringify({ events: tokens.map(token => ({ token })) });

/**
 * Kirim impresi saat halaman ditutup / pengguna keluar: keepalive, tanpa api() agar tidak memicu
 * refresh token atau pesan "Sesi berakhir" (sesi mungkin sudah dihapus). Gagal = diabaikan.
 */
function sendInBackground(tokens: readonly string[]): void {
  void fetch(`/api/web${IMPRESSIONS_PATH}`, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: impressionBody(tokens) }).catch(() => undefined);
}

/**
 * Antrean impresi: dikirim berkala (maks 20 token), saat tab disembunyikan, sebelum klik, dan saat
 * komponen dilepas. Galat jaringan/server/batas laju -> token kembali ke antrean (server mendedupe).
 */
export function useImpressions(demo: boolean) {
  const queue = useRef<string[]>([]);
  const sent = useRef(new Set<string>());
  const inFlight = useRef<Promise<void> | null>(null);
  const take = useCallback((): string[] => {
    const { batch, rest } = takeBatch(queue.current);
    queue.current = rest;
    batch.forEach(token => sent.current.add(token));
    return batch;
  }, []);
  const flush = useCallback(async (): Promise<void> => {
    while (inFlight.current) await inFlight.current;
    const batch = take();
    if (!batch.length || demo) return;
    const request = api(IMPRESSIONS_PATH, { method: "POST", body: impressionBody(batch) })
      .then(() => undefined)
      .catch((error: unknown) => {
        if (!isRetryableImpressionError(error instanceof ApiError ? error.code : null)) return;
        batch.forEach(token => sent.current.delete(token));
        queue.current = [...batch, ...queue.current.filter(token => !batch.includes(token))];
      })
      .finally(() => { inFlight.current = null; });
    inFlight.current = request;
    await request;
  }, [demo, take]);
  const flushInBackground = useCallback(() => { const batch = take(); if (batch.length && !demo) sendInBackground(batch); }, [demo, take]);
  /** `force`: kirim lagi walau pernah terkirim (klik butuh impresi segar agar tidak dinilai SUSPECT). */
  const seen = useCallback((token: string, force = false) => {
    if (force) sent.current.delete(token);
    queue.current = enqueueImpression(queue.current, sent.current, token);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => { void flush(); }, IMPRESSION_FLUSH_MS);
    const onHide = () => { if (document.visibilityState === "hidden") flushInBackground(); };
    document.addEventListener("visibilitychange", onHide);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onHide); flushInBackground(); };
  }, [flush, flushInBackground]);
  return { seen, flush };
}

/** Panggil `onSeen(token)` setelah >= 50% elemen terlihat di layar selama 1 detik (terpotong carousel ikut dihitung). */
export function useSeenOnScreen(ref: RefObject<HTMLElement | null>, token: string, onSeen: (token: string) => void) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { if (timer) clearTimeout(timer); timer = undefined; };
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry || entry.intersectionRatio < VISIBLE_RATIO) { stop(); return; }
      timer ??= setTimeout(() => { timer = undefined; if (document.visibilityState === "visible") onSeen(token); }, VISIBLE_MS);
    }, { threshold: [0, VISIBLE_RATIO, 1] });
    observer.observe(element);
    return () => { observer.disconnect(); stop(); };
  }, [ref, token, onSeen]);
}

async function clickThrough(ad: ServedAd, flush: () => Promise<void>): Promise<string | null> {
  await flush();
  const body = JSON.stringify({ token: ad.token, deviceType: deviceTypeOf(navigator.userAgent, window.innerWidth, navigator.maxTouchPoints) });
  const result = (await api("/student/ads/clicks", { method: "POST", body })).data as AdClickResult;
  return safeTargetUrl(result.targetUrl, result.linkType);
}

const clickError = (error: unknown): string => (error instanceof ApiError && error.code === "RATE_LIMITED" ? "Terlalu sering membuka tautan. Coba lagi sebentar lagi." : "Tautan mitra belum bisa dibuka. Coba lagi.");

interface OpenDeps { readonly demo: boolean; readonly seen: (token: string, force?: boolean) => void; readonly flush: () => Promise<void>; readonly reload: () => void; readonly toast: (text: string) => void }

/**
 * Buka iklan: tab baru dibuka SINKRON di dalam klik (Safari iPhone memblokir window.open setelah
 * await), impresi dikirim dulu agar klik sah, lalu tab diarahkan ke tautan dari server.
 */
export function useOpenAd({ demo, seen, flush, reload, toast }: OpenDeps) {
  const [busy, setBusy] = useState<string | null>(null);
  const open = useCallback((ad: ServedAd) => {
    if (demo) { toast("Mode demo: di aplikasi asli, halaman mitra terbuka di tab baru dan kliknya tercatat untuk laporan sponsor."); return; }
    seen(ad.token, true);
    const tab = ad.linkType === "EXTERNAL_URL" ? window.open("", "_blank") : null;
    if (tab) tab.opener = null;
    setBusy(ad.adId);
    clickThrough(ad, flush).then(url => {
      if (url && tab) tab.location.href = url;
      else if (url) window.location.href = url;
      else { tab?.close(); toast("Info ini sudah tidak tersedia."); reload(); }
    }).catch((error: unknown) => {
      tab?.close();
      if (error instanceof ApiError && error.code === "AD_TOKEN_INVALID") reload();
      toast(clickError(error));
    }).finally(() => setBusy(null));
  }, [demo, seen, flush, reload, toast]);
  return { open, busy };
}

/** Carousel geser (scroll-snap): indeks aktif dari posisi gulir, titik navigasi, dan putar otomatis sampai disentuh. */
export function useCarousel(count: number) {
  const track = useRef<HTMLDivElement>(null);
  const current = useRef(0);
  const [index, setIndex] = useState(0);
  const [touched, setTouched] = useState(false);
  const goTo = useCallback((next: number) => {
    const el = track.current;
    const first = el?.children[0] as HTMLElement | undefined;
    const slide = el?.children[next] as HTMLElement | undefined;
    if (el && first && slide) el.scrollTo({ left: slide.offsetLeft - first.offsetLeft, behavior: "smooth" });
  }, []);
  const onScroll = useCallback(() => {
    const el = track.current;
    const [first, second] = [el?.children[0], el?.children[1]] as (HTMLElement | undefined)[];
    if (!el || !first) return;
    const step = second ? second.offsetLeft - first.offsetLeft : first.offsetWidth;
    const next = Math.min(count - 1, Math.max(0, Math.round(el.scrollLeft / Math.max(1, step))));
    current.current = next;
    setIndex(next);
  }, [count]);
  useEffect(() => {
    if (count < 2 || touched || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") goTo(wrapIndex(current.current, count, 1)); }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [count, touched, goTo]);
  const stop = useCallback(() => setTouched(true), []);
  return { track, index, goTo, onScroll, stop };
}
