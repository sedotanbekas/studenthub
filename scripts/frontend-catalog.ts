/** Kontrak formulir web diturunkan dari OpenAPI agar tetap mengikuti validasi backend. */
import fs from "node:fs";
const document = JSON.parse(fs.readFileSync("docs/openapi.json", "utf8"));
const operations = Object.entries(document.paths).flatMap(([path, methods]) =>
  Object.entries(methods as Record<string, Record<string, unknown>>).filter(([, op]) => op.operationId).map(([method, op]) => {
    const content = (op.requestBody as { content?: Record<string, { schema: unknown }> } | undefined)?.content;
    return { id: op.operationId, path: path.replace("/api/v1", ""), method: method.toUpperCase(), title: op.summary,
      action: String(op.description ?? "").match(/Aksi POLICY: `([^`]+)`/)?.[1] ?? "",
      parameters: op.parameters ?? [], body: content ? Object.values(content)[0]?.schema : undefined,
      multipart: !!content?.["multipart/form-data"] };
  }));
fs.mkdirSync("src/lib/frontend", { recursive: true });
const schemas: Record<string, unknown> = {};
function collect(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref" && typeof child === "string") {
      const name = child.split("/").pop()!;
      if (!(name in schemas)) { schemas[name] = document.components.schemas[name]; collect(schemas[name]); }
    } else collect(child);
  }
}
collect(operations);
fs.writeFileSync("src/lib/frontend/catalog.json", JSON.stringify({ operations, schemas }));
console.log(`${operations.length} operasi frontend disinkronkan.`);
