"use client";
import { useSyncExternalStore } from "react";

/**
 * Isi bagian hub (beranda, absensi, sponsor, moderasi, …) dimuat TERPISAH dari kerangka & halaman masuk:
 * pengunjung yang belum masuk tidak mengunduh ±100 KB JS (terkompresi) yang belum terpakai. Pemuatan
 * dimulai begitu sesi diketahui (akun/demo), saat mulai mengetik di form masuk, atau saat tombol demo
 * ditekan; kerangka hub menahan "Memuat…"/splash sampai modul siap, sehingga isi bagian selalu tersedia
 * secara sinkron (pemulihan gulir & transisi geser bekerja seperti sebelumnya).
 */
type SectionsModule = typeof import("./hub-section");
export interface SectionsState { readonly sections: SectionsModule | null; readonly failed: boolean }

const IDLE: SectionsState = { sections: null, failed: false };
let current: SectionsState = IDLE;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: SectionsState): void {
  current = next;
  listeners.forEach(listener => listener());
}

/** Idempoten: panggilan berikutnya memakai unduhan yang sama. Gagal (jaringan) -> boleh dicoba lagi. */
export function loadSections(): Promise<void> {
  if (current.sections) return Promise.resolve();
  if (current.failed) publish(IDLE);
  pending ??= import("./hub-section").then(
    sections => publish({ sections, failed: false }),
    () => { pending = null; publish({ sections: null, failed: true }); },
  );
  return pending;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useSections(): SectionsState {
  return useSyncExternalStore(subscribe, () => current, () => IDLE);
}
