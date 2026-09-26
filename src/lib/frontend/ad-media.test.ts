import { test } from "node:test";
import assert from "node:assert/strict";
import { bannerSrc, fileSrc, linkHost, sameOriginMedia } from "./ad-media";

test("fileSrc: berkas privat lewat proxy sesi; id demo ke aset statis", () => {
  assert.equal(fileSrc("abc123"), "/api/web/files/abc123");
  assert.equal(fileSrc("a/b"), "/api/web/files/a%2Fb", "id selalu di-encode");
  assert.equal(fileSrc("demo:ads/bimbel-cahaya.svg"), "/demo/ads/bimbel-cahaya.svg");
});

test("sameOriginMedia: URL /media absolut dibaca dari domain yang sedang dibuka", () => {
  assert.equal(sameOriginMedia("https://studenthub.medialab.co.id/media/ad-banner/2026/09/x.webp"), "/media/ad-banner/2026/09/x.webp");
  assert.equal(sameOriginMedia("https://cdn.example/banner.webp"), "https://cdn.example/banner.webp", "bukan /media -> apa adanya");
  assert.equal(sameOriginMedia("/demo/ads/a.svg"), "/demo/ads/a.svg", "path relatif tetap");
});

test("bannerSrc: salinan publik bila ada, selain itu pratinjau privat", () => {
  assert.equal(bannerSrc({ imageUrl: "http://localhost:3030/media/ad-banner/2026/09/x.webp", imageFileId: "f1" }), "/media/ad-banner/2026/09/x.webp");
  assert.equal(bannerSrc({ imageUrl: null, imageFileId: "f1" }), "/api/web/files/f1");
});

test("linkHost menampilkan host tanpa www; string asli bila bukan URL", () => {
  assert.equal(linkHost("https://www.cahayailmu.example/tryout?x=1"), "cahayailmu.example");
  assert.equal(linkHost("bukan url"), "bukan url");
});
