import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cssClassNames, isAdBlockProneName, markupNames } from "./adblock-rules";

test("isAdBlockProneName: awalan yang disasar aturan generik EasyList/AdGuard ditandai", () => {
  for (const name of ["ad", "ads", "ad-card", "ad_slot", "ads-box", "adv-top", "advert", "advertisement-wrap", "advertiser-row", "sponsor", "sponsor-hero", "sponsored", "sponsors-list", "AD-Title"]) {
    assert.equal(isAdBlockProneName(name), true, name);
  }
});

test("isAdBlockProneName: nama netral yang kebetulan diawali huruf 'ad' tetap aman", () => {
  for (const name of ["partner-card", "partner-headline", "brand-hero", "adaptive", "address-line", "admin-nav", "advanced-filter", "badge", "perf-ad", "download"]) {
    assert.equal(isAdBlockProneName(name), false, name);
  }
});

test("cssClassNames: nama kelas dari selector, komentar & angka desimal diabaikan", () => {
  const css = "/* lihat sponsor-home.tsx */\n.partner-card:hover > .ad-media img, .x.y { opacity: 0.5; background: rgb(0 0 0 / 0.58); }";
  assert.deepEqual(cssClassNames(css), ["partner-card", "ad-media", "x", "y"]);
});

test("markupNames: className & id literal, bagian statis template, dan string di dalam ekspresi", () => {
  const tsx = [
    `<div className="a b" id="c">`,
    "<li className={`campaign-item tone-${statusTone(ad.displayStatus)}${many ? \" many\" : \"\"}`}>",
    `<button className={index === i ? "on" : undefined} />`,
  ].join("\n");
  assert.deepEqual(markupNames(tsx), ["a", "b", "c", "campaign-item", "tone-", "many", "on"]);
});

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function filesUnder(dir: string, ext: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(ext))
    .map(entry => path.join(entry.parentPath, entry.name));
}

/**
 * Pengaman regresi: kartu mitra pernah hilang total di browser ber-pemblokir iklan karena kelas
 * `.ad-card` cocok aturan generik `##.ad-card` (EasyList). Semua kelas & id di UI wajib netral.
 */
test("tidak ada kelas CSS atau className/id di komponen yang rawan disembunyikan pemblokir iklan", () => {
  const css = [...filesUnder(path.join(ROOT, "styles"), ".css"), ...filesUnder(path.join(ROOT, "app"), ".css")]
    .flatMap(file => cssClassNames(readFileSync(file, "utf8")).map(name => ({ file, name })));
  const markup = [...filesUnder(path.join(ROOT, "components"), ".tsx"), ...filesUnder(path.join(ROOT, "app"), ".tsx")]
    .flatMap(file => markupNames(readFileSync(file, "utf8")).map(name => ({ file, name })));
  const offenders = [...css, ...markup]
    .filter(({ name }) => isAdBlockProneName(name))
    .map(({ file, name }) => `${path.relative(ROOT, file)}: ${name}`);
  assert.deepEqual([...new Set(offenders)], []);
});
