/**
 * Geometri murni untuk verifikasi lokasi check-in (haversine di server, tanpa Google API).
 */
export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

/** Radius bumi rata-rata (IUGG) dalam meter. */
export const EARTH_RADIUS_M = 6_371_008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Jarak lingkaran besar dua titik (meter). */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

/** (0,0) = "Null Island": nilai bawaan GPS yang gagal, tidak pernah lokasi sekolah di Indonesia. */
export function isNullIsland(point: GeoPoint): boolean {
  return point.latitude === 0 && point.longitude === 0;
}

/** Bulatkan koordinat ke `decimals` desimal. */
export function roundCoord(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
