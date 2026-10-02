import { test } from "node:test";
import assert from "node:assert/strict";
import { dbipMonth, dbipUrl, ispSummary, isDbipDatabaseType, locationSummary, previousDbipMonth, toGeoInfo } from "./rules";

/** Bentuk catatan DB-IP Lite (skema kompatibel GeoLite2), nilai sintetis. */
const CITY = {
  city: { names: { en: "Central Jakarta" } },
  country: { iso_code: "ID", names: { en: "Indonesia" } },
  subdivisions: [{ names: { en: "Jakarta" } }],
  location: { latitude: -6.18, longitude: 106.83 },
};
const ASN = { autonomous_system_number: 23693, autonomous_system_organization: "PT. Telekomunikasi Selular" };

test("toGeoInfo: kota, provinsi, kode negara, ASN, dan ISP dari catatan DB-IP", () => {
  assert.deepEqual(toGeoInfo(CITY, ASN), { city: "Central Jakarta", region: "Jakarta", countryCode: "ID", asn: 23693, isp: "PT. Telekomunikasi Selular" });
});

test("toGeoInfo: IP privat/tidak dikenal (kedua catatan null) -> null; sebagian -> kolom lain null", () => {
  assert.equal(toGeoInfo(null, null), null);
  assert.deepEqual(toGeoInfo(null, ASN), { city: null, region: null, countryCode: null, asn: 23693, isp: "PT. Telekomunikasi Selular" });
  assert.deepEqual(toGeoInfo({ country: { iso_code: "SG" } }, null), { city: null, region: null, countryCode: "SG", asn: null, isp: null });
});

test("toGeoInfo: bentuk tak terduga diabaikan; teks dipotong sesuai panjang kolom", () => {
  assert.deepEqual(toGeoInfo({ city: { names: { en: 42 } }, country: { iso_code: "Indonesia" } }, { autonomous_system_number: "x" }), null);
  const long = toGeoInfo({ city: { names: { en: "K".repeat(300) } } }, { autonomous_system_organization: "I".repeat(300) });
  assert.equal(long?.city?.length, 100);
  assert.equal(long?.isp?.length, 150);
});

test("locationSummary: kota, provinsi, nama negara Bahasa Indonesia; tanpa duplikat & tanpa data -> null", () => {
  assert.equal(locationSummary({ city: "Central Jakarta", region: "Jakarta", countryCode: "ID" }), "Central Jakarta, Jakarta, Indonesia");
  assert.equal(locationSummary({ city: "Singapore", region: "Singapore", countryCode: "SG" }), "Singapore, Singapura");
  assert.equal(locationSummary({ city: null, region: null, countryCode: null }), null);
});

test("ispSummary: nama ISP + nomor AS", () => {
  assert.equal(ispSummary("PT. Telekomunikasi Selular", 23693), "PT. Telekomunikasi Selular (AS23693)");
  assert.equal(ispSummary(null, 23693), "AS23693");
  assert.equal(ispSummary("Google LLC", null), "Google LLC");
  assert.equal(ispSummary(null, null), null);
});

test("dbipMonth/previousDbipMonth: bulan UTC YYYY-MM, mundur melewati tahun", () => {
  assert.equal(dbipMonth(new Date("2026-10-02T03:00:00Z")), "2026-10");
  assert.equal(dbipMonth(new Date("2026-12-31T23:59:59Z")), "2026-12");
  assert.equal(previousDbipMonth("2026-10"), "2026-09");
  assert.equal(previousDbipMonth("2027-01"), "2026-12");
});

test("dbipUrl & isDbipDatabaseType: unduhan resmi DB-IP Lite", () => {
  assert.equal(dbipUrl("city", "2026-10"), "https://download.db-ip.com/free/dbip-city-lite-2026-10.mmdb.gz");
  assert.equal(dbipUrl("asn", "2026-09"), "https://download.db-ip.com/free/dbip-asn-lite-2026-09.mmdb.gz");
  assert.equal(isDbipDatabaseType("city", "DBIP-City-Lite"), true);
  assert.equal(isDbipDatabaseType("asn", "DBIP-ASN-Lite (compat=GeoLite2-ASN)"), true);
  assert.equal(isDbipDatabaseType("city", "DBIP-ASN-Lite"), false);
  assert.equal(isDbipDatabaseType("asn", "GeoLite2-City"), false);
});
