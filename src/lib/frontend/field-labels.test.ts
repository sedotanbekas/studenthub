import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { operations } from "./catalog";
import { hasLabel, label } from "./format";
import { modulesFor } from "./modules";
import { isHiddenField } from "./workspace-rules";

/**
 * Penjaga judul kolom & detail: setiap kunci di respons operasi yang dibuka lewat menu (peran apa pun) wajib
 * punya label Bahasa Indonesia eksplisit, agar tabel generik tidak menampilkan "Academic Year Name" dan
 * sejenisnya. Kunci yang disembunyikan tampilan (isHiddenField: id mentah) dikecualikan.
 */
type Schema = { $ref?: string; properties?: Record<string, Schema>; items?: Schema; anyOf?: Schema[]; oneOf?: Schema[]; allOf?: Schema[] };
const doc = JSON.parse(readFileSync(join(process.cwd(), "docs", "openapi.json"), "utf8")) as {
  paths: Record<string, Record<string, { operationId?: string; responses?: Record<string, { content?: Record<string, { schema?: Schema }> }> }>>;
  components: { schemas: Record<string, Schema> };
};
const resolve = (schema: Schema | undefined): Schema | undefined => (schema?.$ref ? resolve(doc.components.schemas[schema.$ref.split("/").pop()!]) : schema);

function collectKeys(schema: Schema | undefined, into: Set<string>, depth = 0): void {
  const s = resolve(schema);
  if (!s || depth > 6) return;
  for (const alt of [...(s.anyOf ?? []), ...(s.oneOf ?? []), ...(s.allOf ?? [])]) collectKeys(alt, into, depth + 1);
  collectKeys(s.items, into, depth + 1);
  for (const [key, child] of Object.entries(s.properties ?? {})) {
    into.add(key);
    collectKeys(child, into, depth + 1);
  }
}

function menuOperationIds(): Set<string> {
  const ids = new Set<string>();
  for (const entry of (["SCHOOL_ADMIN", "SUPER_ADMIN", "SPONSOR", "STUDENT"] as const).flatMap((role) => modulesFor(role))) {
    for (const op of operations) if (entry.paths.some((path) => op.path === path || op.path.startsWith(`${path}/`))) ids.add(op.id);
  }
  return ids;
}

test("semua kunci respons operasi menu punya label Bahasa Indonesia", () => {
  const wanted = menuOperationIds();
  const keys = new Set<string>();
  for (const item of Object.values(doc.paths)) {
    for (const op of Object.values(item)) {
      if (!op.operationId || !wanted.has(op.operationId)) continue;
      const response = op.responses?.["200"] ?? op.responses?.["201"];
      collectKeys(resolve(response?.content?.["application/json"]?.schema)?.properties?.data, keys);
    }
  }
  const missing = [...keys].filter((key) => !isHiddenField(key) && !hasLabel(key)).sort();
  assert.deepEqual(missing, [], `Tambahkan label untuk: ${missing.join(", ")}`);
  assert.ok(keys.size > 100, "skema respons terbaca");
});

test("label kunci yang dulu tampil mentah sekarang Bahasa Indonesia", () => {
  assert.equal(label("academicYearName"), "Tahun ajaran");
  assert.equal(label("activeStudentCount"), "Siswa aktif");
  assert.equal(label("subjectCount"), "Jumlah mapel");
  assert.equal(label("setupChecklist"), "Kesiapan sekolah");
});
