/**
 * Ekspor dokumen OpenAPI ke docs/openapi.json (dikomit untuk developer frontend/Expo).
 * `--check` gagal bila berkas yang dikomit tidak sama dengan hasil kontrak saat ini (dipakai CI).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildOpenApiDocument } from "../src/lib/openapi/document";
import { ALL_CONTRACTS } from "../src/lib/openapi/registry";

const TARGET = "docs/openapi.json";

function main(): void {
  const doc = buildOpenApiDocument(ALL_CONTRACTS, { version: "v1" });
  const json = `${JSON.stringify(doc, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(TARGET, "utf8");
    } catch {
      current = "";
    }
    if (current.replace(/\r\n/g, "\n") !== json) {
      console.error(`${TARGET} usang. Jalankan: pnpm openapi:export`);
      process.exit(1);
    }
    console.log(`${TARGET} mutakhir (${ALL_CONTRACTS.length} operasi).`);
    return;
  }
  writeFileSync(TARGET, json);
  console.log(`Ditulis ${TARGET} (${ALL_CONTRACTS.length} operasi).`);
}

main();
