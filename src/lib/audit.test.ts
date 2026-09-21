import { test } from "node:test";
import assert from "node:assert/strict";
import { redactForAudit } from "./audit";

test("redactForAudit membuang kunci rahasia di semua kedalaman", () => {
  const input = { name: "Budi", passwordHash: "x", nested: { refreshToken: "t", keep: 1, list: [{ secret: "s", ok: true }] } };
  assert.deepEqual(redactForAudit(input), { name: "Budi", nested: { keep: 1, list: [{ ok: true }] } });
});

test("redactForAudit tidak memutasi input dan mengubah Date/bigint", () => {
  const input = { at: new Date("2026-09-21T00:00:00Z"), big: 10n, totpSecretEnc: "z" };
  const out = redactForAudit(input) as Record<string, unknown>;
  assert.deepEqual(out, { at: "2026-09-21T00:00:00.000Z", big: "10" });
  assert.equal(input.totpSecretEnc, "z");
});

test("redactForAudit memotong string sangat panjang dan kedalaman berlebih", () => {
  const long = "a".repeat(2100);
  assert.equal((redactForAudit({ long }) as { long: string }).long.length, 2003);
  let deep: Record<string, unknown> = { v: 1 };
  for (let i = 0; i < 12; i += 1) deep = { d: deep };
  assert.match(JSON.stringify(redactForAudit(deep)), /terlalu dalam/);
});
