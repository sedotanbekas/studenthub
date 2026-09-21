import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ALL_CONTRACTS } from "./registry";

const API_ROOT = path.join(process.cwd(), "src", "app", "api", "v1");
const NON_CONTRACT_ROUTES = new Set([path.join(API_ROOT, "openapi.json", "route.ts")]);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

const fileForPath = (apiPath: string): string =>
  path.join(process.cwd(), "src", "app", ...apiPath.split("/").filter(Boolean).map((seg) => seg.replace(/^\{(.+)\}$/, "[$1]")), "route.ts");

test("setiap route /api/v1 memakai defineRoute", () => {
  for (const file of routeFiles(API_ROOT)) {
    if (NON_CONTRACT_ROUTES.has(file)) continue;
    assert.match(readFileSync(file, "utf8"), /defineRoute\(/, `${file} harus memakai defineRoute`);
  }
});

test("tidak ada route internal di bawah /api/v1", () => {
  assert.equal(existsSync(path.join(API_ROOT, "internal")), false);
  for (const c of ALL_CONTRACTS) assert.doesNotMatch(c.path, /\/internal\//);
});

test("operationId unik dan setiap kontrak punya berkas route + method", () => {
  const ids = ALL_CONTRACTS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "operationId ganda");
  for (const c of ALL_CONTRACTS) {
    const file = fileForPath(c.path);
    assert.ok(existsSync(file), `berkas route untuk ${c.path} tidak ada (${file})`);
    assert.match(readFileSync(file, "utf8"), new RegExp(String.raw`export const ${c.method}\b`), `${file} tidak mengekspor ${c.method}`);
  }
});

test("parameter path kontrak cocok dengan skema params", () => {
  for (const c of ALL_CONTRACTS) {
    const names = [...c.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).sort();
    const shape = (c.params as { shape?: Record<string, unknown> } | undefined)?.shape ?? {};
    assert.deepEqual(Object.keys(shape).sort(), names, `params ${c.id}`);
  }
});
