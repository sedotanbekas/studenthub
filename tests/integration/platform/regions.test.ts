/**
 * Data referensi yang masuk migrasi (bukan seed): wilayah Kemendagri & PlatformSetting singleton.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, describe, test } from "node:test";
import { disconnect, prisma } from "../helpers/db";

after(disconnect);

const EXPECTED_PROVINCES = 38;
const EXPECTED_CITIES = 514;

type RegionsJson = {
  provinces: { code: string; name: string }[];
  cities: { code: string; provinceCode: string; name: string }[];
};

async function readRegionsJson(): Promise<RegionsJson> {
  const text = await readFile(resolve(process.cwd(), "prisma/data/regions.json"), "utf8");
  return JSON.parse(text) as RegionsJson;
}

describe("platform: data wilayah hasil migrasi", () => {
  test(`${EXPECTED_PROVINCES} provinsi dan ${EXPECTED_CITIES} kabupaten/kota`, async () => {
    assert.equal(await prisma.province.count(), EXPECTED_PROVINCES);
    assert.equal(await prisma.city.count(), EXPECTED_CITIES);
  });

  test("setiap kabupaten/kota merujuk provinsi yang ada dan berprefiks kode provinsinya", async () => {
    const orphans = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM City c LEFT JOIN Province p ON p.code = c.provinceCode WHERE p.code IS NULL`;
    assert.equal(Number(orphans[0]?.n), 0);
    const cities = await prisma.city.findMany({ select: { code: true, provinceCode: true } });
    const mismatched = cities.filter((c) => !c.code.startsWith(`${c.provinceCode}.`));
    assert.deepEqual(mismatched, []);
  });

  test("kode di DB identik dengan prisma/data/regions.json", async () => {
    const data = await readRegionsJson();
    const provinces = await prisma.province.findMany({ select: { code: true }, orderBy: { code: "asc" } });
    const cities = await prisma.city.findMany({ select: { code: true }, orderBy: { code: "asc" } });
    assert.deepEqual(provinces.map((p) => p.code), data.provinces.map((p) => p.code).sort());
    assert.deepEqual(cities.map((c) => c.code), data.cities.map((c) => c.code).sort());
  });

  test("wilayah default factory ada: 32 (Jawa Barat) dan 32.73 (Kota Bandung)", async () => {
    const city = await prisma.city.findUnique({ where: { code: "32.73" } });
    assert.equal(city?.provinceCode, "32");
    assert.ok(await prisma.province.findUnique({ where: { code: "32" } }));
  });
});

describe("platform: PlatformSetting singleton", () => {
  test("baris id=1 ada dengan CPC default Rp 500 dan minimal top-up Rp 100.000", async () => {
    const setting = await prisma.platformSetting.findUnique({ where: { id: 1 } });
    assert.ok(setting, "PlatformSetting id=1 wajib dibuat migrasi init");
    assert.equal(setting.defaultCpcAmount, 500);
    assert.equal(setting.minTopUpAmount, 100_000);
    assert.ok(Array.isArray(setting.deepLinkSchemes), "deepLinkSchemes berupa array JSON");
    assert.equal(await prisma.platformSetting.count(), 1);
  });
});
