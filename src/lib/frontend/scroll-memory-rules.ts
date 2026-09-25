/**
 * Aturan murni ingatan posisi gulir halaman hub (tanpa DOM): setiap halaman mengingat posisi gulirnya
 * sendiri, sehingga pindah tab lalu kembali mendarat di posisi terakhir, bukan di atas. Pelaksana
 * DOM-nya: src/components/hub/scroll-memory.ts.
 */
export type ScrollPositions = Readonly<Record<string, number>>;

/** Satu halaman = satu kunci: path tanpa query/hash (`?absen=1` bukan halaman lain) dan tanpa "/" penutup. */
export function scrollKey(href: string): string {
  const path = href.split(/[?#]/)[0] ?? "";
  return path.replace(/\/+$/, "") || (path ? "/" : "");
}

/** Posisi baru halaman `key` (salinan baru). Pantulan gulir iOS (negatif) dan NaN dianggap posisi atas. */
export function rememberPosition(positions: ScrollPositions, key: string, y: number): ScrollPositions {
  return { ...positions, [key]: Number.isFinite(y) ? Math.max(0, Math.round(y)) : 0 };
}

/** Posisi tujuan halaman: posisi terakhir yang diingat; halaman yang belum pernah dibuka -> atas. */
export function savedPosition(positions: ScrollPositions, key: string): number {
  return positions[key] ?? 0;
}

/** Tautan ke halaman yang sedang dibuka (mis. tab aktif ditekan lagi). */
export function isSamePage(href: string, pathname: string): boolean {
  return scrollKey(href) === scrollKey(pathname);
}
