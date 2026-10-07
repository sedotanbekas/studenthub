import { test } from "node:test";
import assert from "node:assert/strict";
import { isProductionServer } from "./app-env-server";

test("isProductionServer: hanya domain produksi; staging, lokal, kosong, rusak = bukan produksi", () => {
  assert.equal(isProductionServer("https://studenthub.id"), true);
  assert.equal(isProductionServer("https://www.studenthub.id"), true);
  assert.equal(isProductionServer("https://staging.studenthub.id"), false);
  assert.equal(isProductionServer("http://localhost:3030"), false);
  assert.equal(isProductionServer(""), false);
  assert.equal(isProductionServer("bukan url"), false);
});
