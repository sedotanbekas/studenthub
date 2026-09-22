import { test } from "node:test";
import assert from "node:assert/strict";
import { rotationSeed, selectAdsForSlider } from "./rotation";

const ads = (spec: ReadonlyArray<readonly [string, string]>) => spec.map(([id, sponsorId]) => ({ id, sponsorId }));
const TEN = ads(Array.from({ length: 10 }, (_, i) => [`ad${i}`, `sp${i}`] as const));

test("seed rotasi berubah per jam WIB dan per hari WIB", () => {
  const a = rotationSeed("u1", new Date("2026-09-21T02:10:00Z")); // 09:10 WIB
  assert.equal(a, rotationSeed("u1", new Date("2026-09-21T02:59:59Z")));
  assert.notEqual(a, rotationSeed("u1", new Date("2026-09-21T03:00:00Z")));
  assert.equal(rotationSeed("u1", new Date("2026-09-20T17:00:00Z")), "u1:2026-09-21:0", "tengah malam WIB = hari baru");
  assert.equal(rotationSeed("u1", new Date("2026-09-20T16:59:59Z")), "u1:2026-09-20:23");
  assert.notEqual(rotationSeed("u1", new Date("2026-09-21T02:10:00Z")), rotationSeed("u2", new Date("2026-09-21T02:10:00Z")));
});

test("deterministik untuk seed sama; urutan berbeda antar seed", () => {
  const first = selectAdsForSlider(TEN, "u1:2026-09-21:9").map((a) => a.id);
  assert.deepEqual(selectAdsForSlider([...TEN].reverse(), "u1:2026-09-21:9").map((a) => a.id), first, "tidak bergantung urutan input");
  const others = ["u2:2026-09-21:9", "u1:2026-09-21:10", "u1:2026-09-22:9"].map((seed) => selectAdsForSlider(TEN, seed).map((a) => a.id).join());
  assert.ok(others.some((order) => order !== first.join()));
});

test("maks 5 iklan dan maks 2 per sponsor; kandidat sedikit dikembalikan semua; kosong -> kosong", () => {
  const oneSponsor = ads(Array.from({ length: 6 }, (_, i) => [`x${i}`, "big"] as const));
  const mixed = [...oneSponsor, ...ads([["y1", "s2"], ["y2", "s2"], ["y3", "s2"], ["z1", "s3"], ["w1", "s4"]])];
  for (let seed = 0; seed < 50; seed += 1) {
    const picked = selectAdsForSlider(mixed, `seed-${seed}`);
    assert.equal(picked.length, 5);
    const perSponsor = new Map<string, number>();
    for (const ad of picked) perSponsor.set(ad.sponsorId, (perSponsor.get(ad.sponsorId) ?? 0) + 1);
    assert.ok([...perSponsor.values()].every((n) => n <= 2));
  }
  assert.equal(selectAdsForSlider(oneSponsor, "s").length, 2);
  assert.equal(selectAdsForSlider(ads([["a", "1"], ["b", "2"]]), "s").length, 2);
  assert.deepEqual(selectAdsForSlider([], "s"), []);
});

test("setiap iklan mendapat porsi slot pertama yang adil (8%-12% dari 10.000 seed)", () => {
  const firsts = new Map<string, number>();
  for (let i = 0; i < 10_000; i += 1) {
    const id = selectAdsForSlider(TEN, `u${i}:2026-09-21:9`)[0]?.id ?? "";
    firsts.set(id, (firsts.get(id) ?? 0) + 1);
  }
  for (const ad of TEN) {
    const share = (firsts.get(ad.id) ?? 0) / 10_000;
    assert.ok(share >= 0.08 && share <= 0.12, `${ad.id} ${share}`);
  }
});
