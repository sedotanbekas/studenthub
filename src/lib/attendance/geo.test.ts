import { test } from "node:test";
import assert from "node:assert/strict";
import { EARTH_RADIUS_M, haversineMeters, isNullIsland, roundCoord } from "./geo";

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} tidak dalam ${expected} ± ${tolerance}`);

test("haversine: titik sama = 0 m", () => {
  assert.equal(haversineMeters({ latitude: -6.9147, longitude: 107.6098 }, { latitude: -6.9147, longitude: 107.6098 }), 0);
});

test("haversine: 1 derajat bujur di khatulistiwa = 2πR/360 (~111.195 km)", () => {
  near(haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }), (2 * Math.PI * EARTH_RADIUS_M) / 360, 0.01);
});

test("haversine: 0,001 derajat lintang ~111,2 m", () => {
  near(haversineMeters({ latitude: -6.9147, longitude: 107.6098 }, { latitude: -6.9137, longitude: 107.6098 }), 111.2, 0.5);
});

test("haversine: kutub ke kutub = πR", () => {
  near(haversineMeters({ latitude: 90, longitude: 0 }, { latitude: -90, longitude: 0 }), Math.PI * EARTH_RADIUS_M, 0.01);
});

test("haversine: Monas Jakarta ke Gedung Sate Bandung ~119 km", () => {
  const monas = { latitude: -6.175392, longitude: 106.827153 };
  const gedungSate = { latitude: -6.902477, longitude: 107.618782 };
  near(haversineMeters(monas, gedungSate), 119_000, 3_000);
});

test("haversine simetris", () => {
  const a = { latitude: -6.2, longitude: 106.8 };
  const b = { latitude: -7.25, longitude: 112.75 };
  assert.equal(haversineMeters(a, b), haversineMeters(b, a));
});

test("isNullIsland hanya untuk (0,0)", () => {
  assert.equal(isNullIsland({ latitude: 0, longitude: 0 }), true);
  assert.equal(isNullIsland({ latitude: 0, longitude: 0.0001 }), false);
  assert.equal(isNullIsland({ latitude: -0, longitude: 0 }), true);
});

test("roundCoord membulatkan ke n desimal", () => {
  assert.equal(roundCoord(-6.914744, 3), -6.915);
  assert.equal(roundCoord(107.6098123456, 7), 107.6098123);
});
