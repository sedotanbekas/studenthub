import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeLike, likeSearch } from "./like";

test("escapeLike meloloskan %, _ dan backslash; teks biasa tidak berubah", () => {
  assert.equal(escapeLike("100%"), String.raw`100\%`);
  assert.equal(escapeLike("a_b"), String.raw`a\_b`);
  assert.equal(escapeLike(String.raw`c\d`), String.raw`c\\d`);
  assert.equal(escapeLike(String.raw`%_\%`), String.raw`\%\_\\\%`);
  assert.equal(escapeLike("biasa saja@sekolah.id"), "biasa saja@sekolah.id");
  assert.equal(escapeLike(""), "");
});

test("likeSearch: undefined/kosong -> null; selain itu teks terloloskan", () => {
  assert.equal(likeSearch(undefined), null);
  assert.equal(likeSearch(""), null);
  assert.equal(likeSearch("50%"), String.raw`50\%`);
});
