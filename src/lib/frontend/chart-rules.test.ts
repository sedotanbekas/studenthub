import { test } from "node:test";
import assert from "node:assert/strict";
import { areaPath, columnPath, compactNumber, donutArcs, formatChange, integerAxisMax, linePath, nearestIndex, nearestPosition, niceMax, shortDate, stackTotals, ticks, xLabelCount, xPositions } from "./chart-rules";

test("niceMax membulatkan ke atas ke angka bulat yang enak dibaca", () => {
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(7), 8);
  assert.equal(niceMax(93), 100);
  assert.equal(niceMax(412), 500);
  assert.equal(niceMax(1_284), 1_500);
  assert.equal(niceMax(96.4, 100), 100, "batas atas tetap (persen)");
});

test("integerAxisMax: sumbu data hitungan selalu bergaris bantu bulat", () => {
  assert.equal(integerAxisMax(11), 16, "bukan 15 (11,25 per garis)");
  assert.equal(integerAxisMax(3), 4);
  assert.equal(integerAxisMax(0), 4);
  assert.equal(integerAxisMax(1_284), 1_500);
  for (const max of [1, 5, 9, 37, 93, 412, 1_283]) assert.ok(ticks(integerAxisMax(max), 4).every(Number.isInteger), `max ${max}`);
});

test("xLabelCount: jumlah label sumbu-x mengikuti lebar (>= 2)", () => {
  assert.equal(xLabelCount(320), 5);
  assert.equal(xLabelCount(900), 8, "dibatasi 8");
  assert.equal(xLabelCount(60), 2);
});

test("ticks membagi 0..max menjadi garis bantu yang rata", () => {
  assert.deepEqual(ticks(100, 4), [0, 25, 50, 75, 100]);
  assert.deepEqual(ticks(8, 4), [0, 2, 4, 6, 8]);
});

test("compactNumber memakai format ringkas Indonesia", () => {
  assert.equal(compactNumber(950), "950");
  assert.equal(compactNumber(1_284), "1.284");
  // Intl memakai spasi tak-putus (U+00A0) agar angka & satuan tidak terpisah baris.
  assert.equal(compactNumber(12_900), "12,9 rb");
  assert.equal(compactNumber(4_200_000), "4,2 jt");
});

test("xPositions menyebar titik rata di lebar area; satu titik di tengah", () => {
  assert.deepEqual(xPositions(3, 200), [0, 100, 200]);
  assert.deepEqual(xPositions(1, 200), [100]);
  assert.deepEqual(xPositions(0, 200), []);
});

test("nearestIndex memetakan posisi penunjuk ke indeks data terdekat (dibatasi)", () => {
  assert.equal(nearestIndex(0, 5, 400), 0);
  assert.equal(nearestIndex(210, 5, 400), 2);
  assert.equal(nearestIndex(999, 5, 400), 4);
  assert.equal(nearestIndex(-20, 5, 400), 0);
  assert.equal(nearestIndex(50, 1, 400), 0);
});

test("stackTotals menjumlahkan seri yang terlihat per indeks; null dihitung 0", () => {
  assert.deepEqual(stackTotals([[1, 2, null], [3, null, 4]]), [4, 2, 4]);
  assert.deepEqual(stackTotals([]), []);
});

test("donutArcs: sudut proporsional, segmen nol dilewati, total nol -> kosong", () => {
  const arcs = donutArcs([1, 0, 3], 50, 30);
  assert.equal(arcs.length, 2);
  assert.equal(arcs[0]!.index, 0);
  assert.equal(arcs[1]!.index, 2);
  assert.ok(Math.abs(arcs[0]!.end - arcs[0]!.start - Math.PI / 2) < 1e-9);
  assert.ok(arcs.every(a => a.path.startsWith("M")));
  assert.deepEqual(donutArcs([0, 0], 50, 30), []);
});

test("donutArcs: satu segmen penuh tetap tergambar sebagai cincin utuh", () => {
  const arcs = donutArcs([5], 50, 30);
  assert.equal(arcs.length, 1);
  assert.ok(arcs[0]!.path.includes("A"));
});

test("formatChange menampilkan tanda, satu desimal, dan arah", () => {
  assert.deepEqual(formatChange(12.34), { text: "+12,3%", direction: "up" });
  assert.deepEqual(formatChange(-4), { text: "−4,0%", direction: "down" });
  assert.deepEqual(formatChange(0), { text: "0,0%", direction: "flat" });
  assert.deepEqual(formatChange(null), { text: "—", direction: "flat" });
  assert.deepEqual(formatChange(1.5, " poin"), { text: "+1,5 poin", direction: "up" });
});

test("nearestPosition memilih posisi terdekat dari penunjuk", () => {
  assert.equal(nearestPosition([10, 30, 50], 0), 0);
  assert.equal(nearestPosition([10, 30, 50], 36), 1);
  assert.equal(nearestPosition([10, 30, 50], 99), 2);
  assert.equal(nearestPosition([], 5), 0);
});

test("columnPath: ujung atas membulat, alas rata; tinggi 0 -> kosong", () => {
  const path = columnPath(0, 10, 20, 50, 4);
  assert.ok(path.startsWith("M0 60"), "mulai dari alas kiri");
  assert.ok(path.includes("Q"), "sudut atas dibulatkan");
  assert.equal(columnPath(0, 10, 20, 0, 4), "");
  assert.equal(columnPath(0, 10, 20, 50, 0).includes("Q"), false, "segmen tengah tumpukan tanpa lengkung");
});

test("linePath memutus garis pada nilai null; areaPath menutup ke garis dasar", () => {
  const xs = [0, 10, 20, 30];
  const line = linePath(xs, [5, null, 7, 8], v => 100 - v);
  assert.equal(line, "M0 95 M20 93 L30 92");
  const area = areaPath(xs, [5, 6, null, 8], v => 100 - v, 100);
  assert.equal(area, "M0 95 L10 94 L10 100 L0 100 Z M30 92 L30 100 L30 100 Z");
  assert.equal(linePath(xs, [null, null, null, null], v => v), "");
});

test("shortDate menampilkan tanggal & bulan singkat", () => {
  assert.equal(shortDate("2026-09-26"), "26 Sep");
  assert.equal(shortDate("2026-01-03"), "3 Jan");
});
