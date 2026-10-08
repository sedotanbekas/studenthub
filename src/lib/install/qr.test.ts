import { test } from "node:test";
import assert from "node:assert/strict";
import { installQrSvg } from "./qr";

test("installQrSvg: SVG berskala (viewBox, tanpa width/height tetap), latar putih, deterministik", () => {
  const svg = installQrSvg("https://studenthub.id/pasang");
  assert.match(svg, /^<svg [^>]*viewBox="0 0 \d+ \d+"/);
  assert.doesNotMatch(svg.slice(0, svg.indexOf(">")), /\swidth=/);
  assert.match(svg, /<rect fill="white"/);
  assert.doesNotMatch(svg, /<script|\son\w+=|javascript:/i, "disisipkan apa adanya ke halaman: hanya bentuk, tanpa skrip");
  assert.equal(svg, installQrSvg("https://studenthub.id/pasang"));
  assert.notEqual(svg, installQrSvg("https://staging.studenthub.id/pasang"));
});

test("installQrSvg: hanya teks URL http(s) yang disandikan (bukan masukan pengguna)", () => {
  assert.throws(() => installQrSvg("javascript:alert(1)"), /URL/);
  assert.throws(() => installQrSvg("bukan url"), /URL/);
});
