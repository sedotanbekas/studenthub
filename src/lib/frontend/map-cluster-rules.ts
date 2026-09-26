/**
 * Aturan murni peta kehadiran admin: pengelompokan pin berdasarkan jarak PIKSEL pada zoom saat ini
 * (grid hashing, O(n) rata-rata), keputusan klik kelompok (zoom vs. sebar), tata letak sebaran
 * ("spiderfy": lingkaran untuk <= 8 titik, spiral berjari-jari terbatas untuk lebih), dan komposisi
 * status untuk cincin.
 * Tanpa Leaflet/DOM agar bisa diuji dengan node:test.
 */

export interface PixelPoint { readonly x: number; readonly y: number }
export interface ClusterInput extends PixelPoint { readonly id: string }
export interface PixelCluster extends PixelPoint {
  /** `${id bibit}#${jumlah}` — stabil untuk data & zoom yang sama. */
  readonly key: string;
  /** Anggota berurutan sesuai urutan masukan (bibit selalu pertama). */
  readonly ids: readonly string[];
}

/** Radius pengelompokan (px): dua pin berdiameter ~32px masih bisa dibedakan di atas jarak ini. */
export const CLUSTER_RADIUS_PX = 44;
/** Sebaran (px, diproyeksikan pada zoom maksimum) yang masih layak dipisah dengan memperbesar peta. */
export const SEPARABLE_SPREAD_PX = 24;
/** Batas jumlah titik untuk tata letak lingkaran; di atasnya spiral. */
export const SPIDER_CIRCLE_MAX = 8;
/** Di atas jumlah ini spiral memakai jarak rapat agar tumpukan besar tidak meluber jauh. */
export const SPIDER_DENSE_AFTER = 24;
/** Jarak antar-pin spiral rapat (px): pin berdiameter 32px masih tidak saling tumpuk. */
export const SPIDER_DENSE_SEPARATION = 36;
/** Jari-jari sebaran maksimum bawaan (px); pengguna peta boleh mengecilkannya sesuai ukuran peta. */
export const SPIDER_MAX_RADIUS = 170;
/** Jarak antar-pin terkecil saat spiral dipadatkan agar muat di jari-jari maksimum. */
export const SPIDER_MIN_SEPARATION = 24;

const cellKey = (cx: number, cy: number) => `${cx}:${cy}`;

function buildGrid(points: readonly ClusterInput[], cell: number): Map<string, number[]> {
  const grid = new Map<string, number[]>();
  points.forEach((p, index) => {
    const key = cellKey(Math.floor(p.x / cell), Math.floor(p.y / cell));
    const bucket = grid.get(key);
    if (bucket) bucket.push(index);
    else grid.set(key, [index]);
  });
  return grid;
}

function neighbours(grid: Map<string, number[]>, seed: PixelPoint, cell: number): number[] {
  const cx = Math.floor(seed.x / cell);
  const cy = Math.floor(seed.y / cell);
  const found: number[] = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) found.push(...(grid.get(cellKey(cx + dx, cy + dy)) ?? []));
  return found;
}

/**
 * Kelompok greedy: titik pertama yang belum terpakai menjadi bibit, lalu menyerap semua titik yang
 * belum terpakai dalam radius (inklusif) — dicari hanya di 3×3 sel grid bersisi radius.
 */
export function clusterByPixel(points: readonly ClusterInput[], radiusPx: number = CLUSTER_RADIUS_PX): PixelCluster[] {
  const grid = buildGrid(points, radiusPx);
  const used = new Uint8Array(points.length);
  const limit = radiusPx * radiusPx;
  const clusters: PixelCluster[] = [];
  points.forEach((seed, seedIndex) => {
    if (used[seedIndex]) return;
    const members: ClusterInput[] = [];
    for (const i of neighbours(grid, seed, radiusPx).sort((a, b) => a - b)) {
      const p = points[i];
      if (!p || used[i] || (p.x - seed.x) ** 2 + (p.y - seed.y) ** 2 > limit) continue;
      used[i] = 1;
      members.push(p);
    }
    const x = members.reduce((sum, p) => sum + p.x, 0) / members.length;
    const y = members.reduce((sum, p) => sum + p.y, 0) / members.length;
    clusters.push({ key: `${seed.id}#${members.length}`, ids: members.map(p => p.id), x, y });
  });
  return clusters;
}

export function clusterOf(clusters: readonly PixelCluster[], id: string): PixelCluster | undefined {
  return clusters.find(c => c.ids.includes(id));
}

/** Diagonal kotak batas sekumpulan titik (px); 0 untuk kosong/satu titik/titik identik. */
export function pixelSpread(points: readonly PixelPoint[]): number {
  if (points.length < 2) return 0;
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

export type ClusterClick = "zoom" | "spiderfy";

/** Klik kelompok: perbesar bila anggotanya akan terpisah; bila bertumpuk / sudah zoom maksimum -> sebar. */
export function clusterClickAction(input: { spreadAtMaxZoomPx: number; zoom: number; maxZoom: number; thresholdPx?: number }): ClusterClick {
  const threshold = input.thresholdPx ?? SEPARABLE_SPREAD_PX;
  if (input.zoom >= input.maxZoom) return "spiderfy";
  return input.spreadAtMaxZoomPx > threshold ? "zoom" : "spiderfy";
}

/**
 * Zoom terkecil (>= fromZoom) saat titik `id` tampil sendiri (tidak berkelompok); null bila tetap
 * berkelompok sampai maxZoom atau id tidak dikenal. `project(zoom)` memproyeksikan semua titik.
 */
export function firstZoomAlone(
  id: string,
  fromZoom: number,
  maxZoom: number,
  project: (zoom: number) => readonly ClusterInput[],
  radiusPx: number = CLUSTER_RADIUS_PX,
): number | null {
  for (let zoom = fromZoom; zoom <= maxZoom; zoom++) {
    const cluster = clusterOf(clusterByPixel(project(zoom), radiusPx), id);
    if (!cluster) return null;
    if (cluster.ids.length === 1) return zoom;
  }
  return null;
}

export interface SpiderfyOptions {
  /** Jarak antar-pin (px) di sepanjang lingkaran/spiral. */
  readonly separation?: number;
  /** Jarak minimum dari pusat (px) agar pin tidak menutupi gelembung kelompok. */
  readonly minRadius?: number;
  readonly circleMax?: number;
  /** Sudut awal (radian); bawaan -π/2 = mulai dari atas. */
  readonly startAngle?: number;
  /** Jari-jari sebaran maksimum (px), mis. dari ukuran peta; spiral dipadatkan agar tidak melewatinya. */
  readonly maxRadius?: number;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const polar = (radius: number, angle: number): PixelPoint => ({ x: round1(radius * Math.cos(angle)), y: round1(radius * Math.sin(angle)) });

function circleLayout(count: number, separation: number, minRadius: number, start: number): PixelPoint[] {
  const radius = count === 1 ? minRadius : Math.max(minRadius, separation / (2 * Math.sin(Math.PI / count)));
  return Array.from({ length: count }, (_, i) => polar(radius, start + (i * 2 * Math.PI) / count));
}

interface Polar { readonly radius: number; readonly angle: number }

/** Spiral Archimedes: tiap langkah menempuh ±separation di busur; tiap putaran menjauh separation. */
function archimedes(count: number, separation: number, minRadius: number, start: number): Polar[] {
  const result: Polar[] = [];
  let radius = minRadius;
  let angle = start;
  for (let i = 0; i < count; i++) {
    result.push({ radius, angle });
    const step = separation / radius;
    angle += step;
    radius += (separation * step) / (2 * Math.PI);
  }
  return result;
}

/**
 * Spiral untuk tumpukan > circleMax. Di atas SPIDER_DENSE_AFTER titik jaraknya dirapatkan; bila masih
 * melewati `maxRadius`, jarak dipadatkan (r² ≈ r0² + n·s²/π) sampai SPIDER_MIN_SEPARATION, lalu sisa
 * kelebihannya diskalakan radial — jari-jari sebaran tidak pernah melewati batas, berapa pun jumlahnya.
 */
function spiralLayout(count: number, separation: number, minRadius: number, start: number, maxRadius: number): PixelPoint[] {
  const limit = Math.max(minRadius, maxRadius);
  const preferred = count > SPIDER_DENSE_AFTER ? Math.min(separation, SPIDER_DENSE_SEPARATION) : separation;
  const fit = Math.sqrt((Math.PI * (limit ** 2 - minRadius ** 2)) / Math.max(1, count - 1));
  const spacing = Math.max(Math.min(preferred, SPIDER_MIN_SEPARATION), Math.min(preferred, fit));
  const spiral = archimedes(count, spacing, minRadius, start);
  const reach = spiral.at(-1)?.radius ?? minRadius;
  const squeeze = reach > limit ? (limit - minRadius) / (reach - minRadius) : 1;
  return spiral.map(p => polar(minRadius + (p.radius - minRadius) * squeeze, p.angle));
}

/** Offset piksel (relatif pusat kelompok) untuk menyebar `count` pin. */
export function spiderfyLayout(count: number, options: SpiderfyOptions = {}): PixelPoint[] {
  if (count <= 0) return [];
  const separation = options.separation ?? 44;
  const minRadius = options.minRadius ?? 40;
  const start = options.startAngle ?? -Math.PI / 2;
  return count <= (options.circleMax ?? SPIDER_CIRCLE_MAX)
    ? circleLayout(count, separation, minRadius, start)
    : spiralLayout(count, separation, minRadius, start, options.maxRadius ?? SPIDER_MAX_RADIUS);
}

export interface Slice { readonly key: string; readonly from: number; readonly to: number }

/** Irisan persen kumulatif (untuk conic-gradient); nilai 0 dilewati, irisan terakhir tepat 100. */
export function compositionSlices(parts: readonly { key: string; value: number }[]): Slice[] {
  const present = parts.filter(p => p.value > 0);
  const total = present.reduce((sum, p) => sum + p.value, 0);
  let cumulative = 0;
  return present.map((p, index) => {
    const from = (cumulative / total) * 100;
    cumulative += p.value;
    return { key: p.key, from, to: index === present.length - 1 ? 100 : (cumulative / total) * 100 };
  });
}

const HTML_ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Netralkan teks sebelum masuk ke HTML ikon/tooltip Leaflet (yang memakai innerHTML). */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, ch => HTML_ESCAPES[ch] ?? ch);
}
