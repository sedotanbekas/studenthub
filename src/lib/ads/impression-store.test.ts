import { test } from "node:test";
import assert from "node:assert/strict";
import { createImpressionStore } from "./impression-store";

const MIN = 60_000;
const t0 = new Date("2026-09-21T03:00:00.000Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

test("impresi dihitung sekali per 30 menit per siswa/iklan, lalu dihitung lagi", () => {
  const store = createImpressionStore({ windowMs: 30 * MIN, maxEntries: 100 });
  assert.equal(store.record("u1", "a1", t0), "ACCEPTED");
  assert.equal(store.record("u1", "a1", at(29 * MIN)), "DUPLICATE");
  assert.equal(store.record("u1", "a1", at(30 * MIN)), "ACCEPTED");
  assert.equal(store.record("u2", "a1", t0), "ACCEPTED", "kunci terisolasi per siswa");
  assert.equal(store.record("u1", "a2", t0), "ACCEPTED", "kunci terisolasi per iklan");
});

test("impresi terakhir (termasuk duplikat) dipakai untuk menilai klik", () => {
  const store = createImpressionStore({ windowMs: 30 * MIN, maxEntries: 100 });
  assert.equal(store.seenWithin("u1", "a1", t0, 30 * MIN), false);
  store.record("u1", "a1", t0);
  store.record("u1", "a1", at(20 * MIN));
  assert.equal(store.seenWithin("u1", "a1", at(45 * MIN), 30 * MIN), true, "duplikat menit ke-20 masih dalam jendela");
  assert.equal(store.seenWithin("u1", "a1", at(51 * MIN), 30 * MIN), false);
  assert.equal(store.seenWithin("u1", "a1", at(-1), 30 * MIN), false, "impresi setelah klik tidak dihitung");
});

test("entri tertua dibuang saat melewati kapasitas", () => {
  const store = createImpressionStore({ windowMs: 30 * MIN, maxEntries: 2 });
  store.record("u1", "a1", t0);
  store.record("u2", "a1", t0);
  store.record("u3", "a1", t0);
  assert.equal(store.size(), 2);
  assert.equal(store.seenWithin("u1", "a1", t0, 30 * MIN), false);
  assert.equal(store.seenWithin("u3", "a1", t0, 30 * MIN), true);
  store.clear();
  assert.equal(store.size(), 0);
});
