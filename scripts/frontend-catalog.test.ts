import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/**
 * Penjaga `pnpm frontend:sync`: proxy /api/web hanya meneruskan operasi yang ada di catalog.json. Bila kontrak
 * baru lupa disinkronkan, endpoint itu 404 dari browser walau API v1 berjalan — test ini merah lebih dulu.
 */
test("catalog.json memuat persis operasi docs/openapi.json (jalankan pnpm frontend:sync)", () => {
  const document = JSON.parse(fs.readFileSync("docs/openapi.json", "utf8")) as { paths: Record<string, Record<string, { operationId?: string }>> };
  const catalog = JSON.parse(fs.readFileSync("src/lib/frontend/catalog.json", "utf8")) as { operations: { id: string; path: string; method: string }[] };
  const fromOpenApi = Object.entries(document.paths)
    .flatMap(([path, methods]) => Object.entries(methods).filter(([, op]) => op.operationId).map(([method, op]) => `${method.toUpperCase()} ${path.replace("/api/v1", "")} ${op.operationId}`))
    .sort();
  const fromCatalog = catalog.operations.map((op) => `${op.method} ${op.path} ${op.id}`).sort();
  assert.deepEqual(fromCatalog, fromOpenApi);
});
