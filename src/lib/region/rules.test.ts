import { test } from "node:test";
import assert from "node:assert/strict";
import { cityInProvince, regionSchoolWhere, schoolInRegion } from "./rules";

test("regionSchoolWhere: admin provinsi = semua kota di provinsinya; admin kota = kota itu saja", () => {
  assert.deepEqual(regionSchoolWhere({ provinceCode: "32", cityCode: null }), { provinceCode: "32" });
  assert.deepEqual(regionSchoolWhere({ provinceCode: "32", cityCode: "32.76" }), { provinceCode: "32", cityCode: "32.76" });
});

test("schoolInRegion: provinsi & kota harus cocok", () => {
  const depok = { provinceCode: "32", cityCode: "32.76" };
  assert.equal(schoolInRegion({ provinceCode: "32", cityCode: null }, depok), true);
  assert.equal(schoolInRegion({ provinceCode: "32", cityCode: "32.76" }, depok), true);
  assert.equal(schoolInRegion({ provinceCode: "32", cityCode: "32.73" }, depok), false);
  assert.equal(schoolInRegion({ provinceCode: "31", cityCode: null }, depok), false);
});

test("cityInProvince: kode kota berawalan kode provinsinya", () => {
  assert.equal(cityInProvince("32.76", "32"), true);
  assert.equal(cityInProvince("31.71", "32"), false);
  assert.equal(cityInProvince("3276", "32"), false);
});
