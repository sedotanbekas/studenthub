import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_ADS, DEMO_SPONSOR, DEMO_TRAFFIC_DAYS, demoAdTraffic, demoDeviceType, demoSponsorTimeline } from "./demo-sponsor-plan";

const NOW = new Date("2026-09-21T05:00:00.000Z");

test("akun & iklan demo memakai domain demo dan tautan https", () => {
  assert.match(DEMO_SPONSOR.email, /@demo\.studenthub\.id$/);
  assert.ok(DEMO_ADS.length >= 2);
  assert.ok(DEMO_ADS.every((ad) => ad.targetUrl.startsWith("https://")));
  assert.equal(new Set(DEMO_ADS.map((ad) => ad.title)).size, DEMO_ADS.length);
});

test("lini masa: top-up & persetujuan sebelum hari trafik pertama; jadwal iklan mencakup trafik dan masa depan", () => {
  const t = demoSponsorTimeline(NOW);
  assert.ok(t.topUpAt < t.topUpApprovedAt && t.topUpApprovedAt < t.adCreatedAt && t.adCreatedAt < t.adApprovedAt);
  assert.ok(t.adApprovedAt < t.adStartAt || t.adApprovedAt.getTime() === t.adStartAt.getTime());
  const firstTraffic = demoAdTraffic(NOW, 0)[0];
  assert.ok(firstTraffic && t.adStartAt <= firstTraffic.at);
  assert.ok(t.adEndAt.getTime() > NOW.getTime() + 30 * 86_400_000);
});

test("trafik deterministik: 14 hari lalu s.d. kemarin, impresi > klik, klik siswa unik per hari", () => {
  const traffic = demoAdTraffic(NOW, 0);
  assert.deepEqual(demoAdTraffic(NOW, 0), traffic);
  assert.equal(traffic.length, DEMO_TRAFFIC_DAYS);
  assert.ok(traffic.every((d) => d.at.getTime() < NOW.getTime()));
  for (const day of traffic) {
    assert.ok(day.impressions > day.clickerIndexes.length);
    assert.equal(new Set(day.clickerIndexes).size, day.clickerIndexes.length);
    assert.ok(day.clickerIndexes.every((i) => i >= 0 && i < 30));
  }
  assert.notDeepEqual(demoAdTraffic(NOW, 1).map((d) => d.clickerIndexes), traffic.map((d) => d.clickerIndexes));
});

test("perangkat demo sebagian besar mobile", () => {
  const devices = Array.from({ length: 20 }, (_, i) => demoDeviceType(i));
  assert.ok(devices.filter((d) => d === "MOBILE").length > devices.length / 2);
  assert.ok(devices.includes("TABLET"));
});
