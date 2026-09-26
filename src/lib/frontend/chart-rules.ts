/**
 * Aturan murni grafik (tanpa DOM): skala sumbu, penempatan titik, penunjuk ke indeks data, busur donat,
 * dan format angka/perubahan. Dipakai komponen src/components/hub/charts/*.
 */
const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** Batas atas sumbu yang "bulat" (>= nilai maksimum). `cap` = batas tetap (mis. 100 untuk persen). */
export function niceMax(max: number, cap?: number): number {
  if (cap !== undefined) return cap;
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const step = NICE_STEPS.find(s => s * magnitude >= max) ?? 10;
  return step * magnitude;
}

/** Batas atas sumbu untuk data hitungan (bilangan bulat): kelipatan `count` agar setiap garis bantu bulat. */
export function integerAxisMax(max: number, count = 4): number {
  const nice = niceMax(Math.max(max, 1));
  return Math.max(count, Math.ceil(nice / count) * count);
}

/** Jumlah label tanggal di sumbu-x yang muat tanpa bertumpuk (~64 px per label, 2..8). */
export function xLabelCount(plotWidth: number): number {
  return Math.min(8, Math.max(2, Math.floor(plotWidth / 64)));
}

/** Nilai garis bantu 0..max dibagi `count` bagian sama. */
export function ticks(max: number, count = 4): number[] {
  return Array.from({ length: count + 1 }, (_, i) => Math.round(((max * i) / count) * 100) / 100);
}

const fullNumber = new Intl.NumberFormat("id-ID");
const compact = new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 });
/** Angka ringkas: < 10.000 ditulis lengkap ("1.284"), di atasnya "12,9 rb" / "4,2 jt". */
export function compactNumber(value: number): string {
  return Math.abs(value) < 10_000 ? fullNumber.format(value) : compact.format(value);
}

/** Posisi x tiap titik, rata dari 0 sampai `width`; satu titik diletakkan di tengah. */
export function xPositions(count: number, width: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [width / 2];
  return Array.from({ length: count }, (_, i) => (width * i) / (count - 1));
}

/** Indeks data terdekat dari posisi penunjuk `x` (0..width), selalu di dalam rentang. */
export function nearestIndex(x: number, count: number, width: number): number {
  if (count <= 1 || width <= 0) return 0;
  const index = Math.round((x / width) * (count - 1));
  return Math.min(count - 1, Math.max(0, index));
}

/** Indeks posisi terdekat dari penunjuk `x` (posisi boleh tidak rata, mis. tengah pita kolom). */
export function nearestPosition(positions: readonly number[], x: number): number {
  let best = 0;
  positions.forEach((p, i) => { if (Math.abs(p - x) < Math.abs((positions[best] ?? 0) - x)) best = i; });
  return best;
}

const r1 = (n: number): string => String(Math.round(n * 10) / 10);

/** Kolom dengan ujung atas membulat (radius `r`) dan alas rata di y+h; h <= 0 -> "". */
export function columnPath(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0 || w <= 0) return "";
  const rr = Math.min(r, h, w / 2);
  const [left, right, top, bottom] = [r1(x), r1(x + w), r1(y), r1(y + h)];
  if (rr <= 0) return `M${left} ${bottom} V${top} H${right} V${bottom} Z`;
  return `M${left} ${bottom} V${r1(y + rr)} Q${left} ${top} ${r1(x + rr)} ${top} H${r1(x + w - rr)} Q${right} ${top} ${right} ${r1(y + rr)} V${bottom} Z`;
}

/** Potongan titik berurutan tanpa null (garis diputus pada data kosong). */
function runs(xs: readonly number[], values: ReadonlyArray<number | null>, y: (v: number) => number): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  values.forEach((v, i) => {
    if (v === null || xs[i] === undefined) { if (current.length) out.push(current); current = []; return; }
    current.push([xs[i]!, y(v)]);
  });
  if (current.length) out.push(current);
  return out;
}

export function linePath(xs: readonly number[], values: ReadonlyArray<number | null>, y: (v: number) => number): string {
  return runs(xs, values, y).map(run => run.map(([px, py], i) => `${i ? "L" : "M"}${r1(px)} ${r1(py)}`).join(" ")).join(" ");
}

/** Area di bawah garis sampai `baseline` (koordinat y), per potongan tanpa null. */
export function areaPath(xs: readonly number[], values: ReadonlyArray<number | null>, y: (v: number) => number, baseline: number): string {
  return runs(xs, values, y).map(run => {
    const top = run.map(([px, py], i) => `${i ? "L" : "M"}${r1(px)} ${r1(py)}`).join(" ");
    const last = run[run.length - 1]!;
    return `${top} L${r1(last[0])} ${r1(baseline)} L${r1(run[0]![0])} ${r1(baseline)} Z`;
  }).join(" ");
}

/** Jumlah per indeks dari beberapa seri (untuk kolom bertumpuk); null = 0. */
export function stackTotals(series: ReadonlyArray<ReadonlyArray<number | null>>): number[] {
  const length = Math.max(0, ...series.map(s => s.length));
  return Array.from({ length }, (_, i) => series.reduce((sum, s) => sum + (s[i] ?? 0), 0));
}

export interface DonutArc { readonly index: number; readonly start: number; readonly end: number; readonly path: string }
const TAU = Math.PI * 2;
const point = (radius: number, angle: number): string => `${(radius * Math.sin(angle)).toFixed(3)} ${(-radius * Math.cos(angle)).toFixed(3)}`;

/** Satu busur cincin berpusat di (0,0), sudut 0 = jam 12, searah jarum jam. */
function ringPath(start: number, end: number, outer: number, inner: number): string {
  const sweep = Math.min(end - start, TAU - 1e-4);
  const stop = start + sweep;
  const large = sweep > Math.PI ? 1 : 0;
  return `M${point(outer, start)} A${outer} ${outer} 0 ${large} 1 ${point(outer, stop)} L${point(inner, stop)} A${inner} ${inner} 0 ${large} 0 ${point(inner, start)} Z`;
}

/** Busur donat per nilai (> 0 saja), proporsional terhadap total. */
export function donutArcs(values: readonly number[], outer: number, inner: number): DonutArc[] {
  const total = values.reduce((sum, v) => sum + Math.max(0, v), 0);
  if (total <= 0) return [];
  let angle = 0;
  return values.flatMap((value, index) => {
    if (value <= 0) return [];
    const start = angle;
    angle += (value / total) * TAU;
    return [{ index, start, end: angle, path: ringPath(start, angle, outer, inner) }];
  });
}

export interface Change { readonly text: string; readonly direction: "up" | "down" | "flat" }
const oneDecimal = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** Perubahan bertanda satu desimal ("+12,3%", "−4,0%"); null -> "—". */
export function formatChange(change: number | null, unit = "%"): Change {
  if (change === null || !Number.isFinite(change)) return { text: "—", direction: "flat" };
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const sign = change > 0 ? "+" : change < 0 ? "−" : "";
  return { text: `${sign}${oneDecimal.format(Math.abs(change))}${unit}`, direction };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
/** "2026-09-26" -> "26 Sep". */
export function shortDate(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${day ?? ""} ${MONTHS[(month ?? 1) - 1] ?? ""}`.trim();
}

/** "2026-09-26" -> "Sabtu, 26 Sep" (nama hari untuk tooltip). */
export function dayLabel(date: string): string {
  const weekday = new Intl.DateTimeFormat("id-ID", { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
  return `${weekday}, ${shortDate(date)}`;
}
