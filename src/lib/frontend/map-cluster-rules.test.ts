import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLUSTER_RADIUS_PX,
  clusterByPixel,
  clusterClickAction,
  clusterOf,
  compositionSlices,
  escapeHtml,
  firstZoomAlone,
  pixelSpread,
  SPIDER_DENSE_AFTER,
  SPIDER_DENSE_SEPARATION,
  SPIDER_MAX_RADIUS,
  spiderfyLayout,
  type ClusterInput,
  type PixelPoint,
} from "./map-cluster-rules";

const dist = (a: PixelPoint, b: PixelPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const minPairDistance = (points: readonly PixelPoint[]) => {
  let min = Infinity;
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) min = Math.min(min, dist(points[i]!, points[j]!));
  return min;
};

test("clusterByPixel: titik berdekatan (< radius) digabung, yang jauh tetap sendiri", () => {
  const points: ClusterInput[] = [
    { id: "a", x: 100, y: 100 },
    { id: "b", x: 110, y: 105 },
    { id: "c", x: 100, y: 100 },
    { id: "d", x: 400, y: 400 },
  ];
  const clusters = clusterByPixel(points);
  assert.equal(clusters.length, 2);
  const big = clusters.find(c => c.ids.length === 3);
  assert.ok(big, "a, b, c satu kelompok");
  assert.deepEqual([...big.ids].sort(), ["a", "b", "c"]);
  assert.ok(Math.abs(big.x - 310 / 3) < 1e-9 && Math.abs(big.y - 305 / 3) < 1e-9, "posisi = titik berat anggota");
  assert.deepEqual(clusters.find(c => c.ids.length === 1)?.ids, ["d"]);
});

test("clusterByPixel: setiap titik tepat satu kali; batas radius inklusif; melintasi batas sel grid", () => {
  const r = CLUSTER_RADIUS_PX;
  const points: ClusterInput[] = [
    { id: "seed", x: r - 1, y: r - 1 },
    { id: "edge", x: r - 1 + r, y: r - 1 },
    { id: "out", x: r - 1 + r + 0.5, y: r - 1 + r },
  ];
  const clusters = clusterByPixel(points);
  const all = clusters.flatMap(c => c.ids).sort();
  assert.deepEqual(all, ["edge", "out", "seed"]);
  assert.deepEqual(clusterOf(clusters, "edge")?.ids, ["seed", "edge"], "tepat di radius = satu kelompok walau beda sel");
  assert.equal(clusterOf(clusters, "out")?.ids.length, 1);
});

test("clusterByPixel: kunci stabil (id bibit + jumlah), kosong -> kosong, deterministik", () => {
  assert.deepEqual(clusterByPixel([]), []);
  const points: ClusterInput[] = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, x: (i % 10) * 30, y: Math.floor(i / 10) * 30 }));
  const first = clusterByPixel(points);
  assert.deepEqual(clusterByPixel(points), first);
  assert.equal(first[0]!.key, `p0#${first[0]!.ids.length}`);
  assert.equal(new Set(first.map(c => c.key)).size, first.length, "kunci unik");
});

test("clusterByPixel: 5000 titik diproses cepat (grid hashing, bukan O(n²))", () => {
  const points: ClusterInput[] = Array.from({ length: 5000 }, (_, i) => ({ id: `p${i}`, x: (i * 7919) % 3000, y: (i * 104729) % 3000 }));
  const started = performance.now();
  const clusters = clusterByPixel(points);
  assert.ok(performance.now() - started < 500);
  assert.equal(clusters.reduce((sum, c) => sum + c.ids.length, 0), 5000);
});

test("pixelSpread: diagonal kotak batas; satu titik / titik identik = 0", () => {
  assert.equal(pixelSpread([]), 0);
  assert.equal(pixelSpread([{ x: 5, y: 5 }]), 0);
  assert.equal(pixelSpread([{ x: 5, y: 5 }, { x: 5, y: 5 }]), 0);
  assert.equal(pixelSpread([{ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 10, y: 10 }]), 50);
});

test("clusterClickAction: bisa dipisah dengan zoom -> zoom; bertumpuk atau sudah zoom maksimum -> spiderfy", () => {
  assert.equal(clusterClickAction({ spreadAtMaxZoomPx: 120, zoom: 17, maxZoom: 19 }), "zoom");
  assert.equal(clusterClickAction({ spreadAtMaxZoomPx: 0, zoom: 17, maxZoom: 19 }), "spiderfy", "koordinat persis sama");
  assert.equal(clusterClickAction({ spreadAtMaxZoomPx: 24, zoom: 17, maxZoom: 19 }), "spiderfy", "ambang inklusif");
  assert.equal(clusterClickAction({ spreadAtMaxZoomPx: 25, zoom: 17, maxZoom: 19 }), "zoom");
  assert.equal(clusterClickAction({ spreadAtMaxZoomPx: 300, zoom: 19, maxZoom: 19 }), "spiderfy", "tidak bisa zoom lagi");
  assert.equal(clusterClickAction({ spreadAtMaxZoomPx: 40, zoom: 17, maxZoom: 19, thresholdPx: 50 }), "spiderfy");
});

test("spiderfyLayout: 0 -> kosong; 1 -> satu titik sejauh radius minimum", () => {
  assert.deepEqual(spiderfyLayout(0), []);
  assert.deepEqual(spiderfyLayout(-3), []);
  const [only] = spiderfyLayout(1, { minRadius: 40 });
  assert.ok(Math.abs(dist(only!, { x: 0, y: 0 }) - 40) < 0.1);
});

test("spiderfyLayout: <= 8 titik membentuk lingkaran (jarak ke pusat sama), tidak saling tumpuk", () => {
  for (const count of [2, 3, 5, 8]) {
    const layout = spiderfyLayout(count, { separation: 44, minRadius: 40 });
    assert.equal(layout.length, count);
    const radii = layout.map(p => dist(p, { x: 0, y: 0 }));
    assert.ok(Math.max(...radii) - Math.min(...radii) < 0.2, `lingkaran untuk ${count}`);
    assert.ok(Math.min(...radii) >= 40 - 0.1, "tidak menutupi gelembung pusat");
    assert.ok(minPairDistance(layout) >= 44 - 0.5, `jarak antar-pin >= separation (${count})`);
  }
});

test("spiderfyLayout: lingkaran dimulai dari atas (sudut -90°)", () => {
  const [first] = spiderfyLayout(4, { separation: 44, minRadius: 40 });
  assert.ok(Math.abs(first!.x) < 0.1 && first!.y < 0);
});

const reach = (points: readonly PixelPoint[]) => Math.max(...points.map(p => dist(p, { x: 0, y: 0 })));
const assertSpiral = (layout: readonly PixelPoint[], label: string) => {
  const radii = layout.map(p => dist(p, { x: 0, y: 0 }));
  for (let i = 1; i < radii.length; i++) assert.ok(radii[i]! >= radii[i - 1]! - 0.1, `jari-jari tidak mengecil (${label})`);
  assert.ok(radii[0]! >= 40 - 0.1, `tidak menutupi gelembung pusat (${label})`);
};

test("spiderfyLayout: > 8 titik membentuk spiral (menjauh dari pusat), rapi dan tidak saling tumpuk", () => {
  for (const count of [9, 16, SPIDER_DENSE_AFTER]) {
    const layout = spiderfyLayout(count, { separation: 44, minRadius: 40 });
    assert.equal(layout.length, count);
    assertSpiral(layout, String(count));
    assert.ok(minPairDistance(layout) >= 44 * 0.85, `jarak minimum spiral (${count})`);
  }
  assert.ok(reach(spiderfyLayout(26, { separation: 44, minRadius: 40 })) < 190, "26 siswa masih muat di peta HP");
});

test("spiderfyLayout: tumpukan besar (> 24) memakai spiral lebih rapat, tetap tidak saling tumpuk", () => {
  for (const count of [SPIDER_DENSE_AFTER + 1, 40, 60]) {
    const layout = spiderfyLayout(count, { separation: 44, minRadius: 40 });
    assert.equal(layout.length, count);
    assertSpiral(layout, String(count));
    assert.ok(minPairDistance(layout) >= SPIDER_DENSE_SEPARATION * 0.85, `jarak minimum spiral rapat (${count})`);
    assert.ok(minPairDistance(layout) < 44 * 0.85, `lebih rapat dari jarak bawaan (${count})`);
  }
  assert.ok(reach(spiderfyLayout(60, { separation: 44, minRadius: 40 })) <= SPIDER_MAX_RADIUS + 0.1, "60 siswa tidak meluber jauh");
});

test("spiderfyLayout: jari-jari spiral dibatasi (bawaan & dari ukuran peta), berapa pun jumlah titiknya", () => {
  for (const count of [120, 300, 1000]) {
    const layout = spiderfyLayout(count, { separation: 44, minRadius: 40 });
    assert.equal(layout.length, count);
    assertSpiral(layout, String(count));
    assert.ok(reach(layout) <= SPIDER_MAX_RADIUS + 0.1, `batas jari-jari bawaan (${count})`);
  }
  const phone = spiderfyLayout(20, { separation: 44, minRadius: 40, maxRadius: 110 });
  assert.ok(reach(phone) <= 110 + 0.1, "peta HP sempit: spiral dipadatkan agar muat");
  assert.ok(minPairDistance(phone) >= 32, "pemadatan ringan tetap tidak saling tumpuk (pin 32px)");
  assert.ok(reach(spiderfyLayout(500, { maxRadius: 110 })) <= 110 + 0.1);
});

test("spiderfyLayout: deterministik & mengikuti opsi circleMax", () => {
  assert.deepEqual(spiderfyLayout(12), spiderfyLayout(12));
  const asCircle = spiderfyLayout(10, { circleMax: 12, separation: 44, minRadius: 40 }).map(p => dist(p, { x: 0, y: 0 }));
  assert.ok(Math.max(...asCircle) - Math.min(...asCircle) < 0.2);
});

test("firstZoomAlone: zoom terkecil saat titik tidak lagi berkelompok; null bila bertumpuk sampai zoom maksimum", () => {
  const base = [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 1, y: 0 },
    { id: "c", x: 1, y: 0 },
    { id: "far", x: 1000, y: 0 },
  ];
  const project = (zoom: number): ClusterInput[] => base.map(p => ({ id: p.id, x: p.x * 2 ** zoom, y: p.y * 2 ** zoom }));
  assert.equal(firstZoomAlone("far", 0, 19, project), 0, "sudah sendiri");
  assert.equal(firstZoomAlone("a", 0, 19, project), 6, "2^6 = 64 px > 44 px");
  assert.equal(firstZoomAlone("b", 0, 19, project), null, "b & c koordinatnya sama");
  assert.equal(firstZoomAlone("x", 0, 19, project), null, "id tidak dikenal");
  assert.equal(firstZoomAlone("a", 10, 19, project), 10, "tidak pernah menjauh (zoom out)");
});

test("compositionSlices: persen kumulatif, 0 dilewati, berakhir tepat 100", () => {
  assert.deepEqual(compositionSlices([]), []);
  assert.deepEqual(compositionSlices([{ key: "a", value: 0 }]), []);
  const slices = compositionSlices([{ key: "HADIR", value: 3 }, { key: "IZIN", value: 0 }, { key: "TERLAMBAT", value: 1 }]);
  assert.deepEqual(slices, [{ key: "HADIR", from: 0, to: 75 }, { key: "TERLAMBAT", from: 75, to: 100 }]);
  const thirds = compositionSlices([{ key: "a", value: 1 }, { key: "b", value: 1 }, { key: "c", value: 1 }]);
  assert.equal(thirds.at(-1)?.to, 100);
  assert.equal(thirds[1]?.from, thirds[0]?.to, "bersambung tanpa celah");
});

test("escapeHtml: karakter HTML dinetralkan (nama siswa masuk ke ikon/tooltip Leaflet)", () => {
  assert.equal(escapeHtml(`<img src=x onerror="a('b')">&`), "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
  assert.equal(escapeHtml("Siti Nur'aini"), "Siti Nur&#39;aini");
});
