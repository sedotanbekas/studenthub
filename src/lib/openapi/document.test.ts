import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { defineContract } from "@/lib/http/contract";
import { ENUM_LABELS } from "@/lib/platform/enum-labels";
import { buildOpenApiDocument } from "./document";
import { ALL_CONTRACTS } from "./registry";

test("dokumen OpenAPI terbentuk dari semua kontrak terdaftar", () => {
  const doc = buildOpenApiDocument(ALL_CONTRACTS, { version: "uji", serverUrl: "http://localhost" });
  assert.equal(doc.openapi, "3.1.0");
  assert.equal(Object.values(doc.paths ?? {}).flatMap((p) => Object.keys(p ?? {})).length, ALL_CONTRACTS.length);
  assert.ok(doc.components?.schemas?.ErrorEnvelope);
  assert.ok(doc.components?.securitySchemes?.bearerAuth);
});

test("operasi publik tanpa security; operasi terautentikasi punya 401/403 & body/paginasi", () => {
  const contract = defineContract({
    id: "ujiBuat",
    method: "POST",
    path: "/api/v1/uji/{id}",
    tag: "Uji",
    summary: "Uji",
    action: "region.read",
    params: z.object({ id: z.string() }),
    query: z.object({ q: z.string().optional() }),
    body: z.object({ nama: z.string() }),
    response: z.array(z.object({ id: z.string() })),
    pagination: "page",
    rateLimit: { limiter: "UPLOAD", key: "user" },
    errors: ["KODE_UJI"],
    successStatus: 201,
  });
  const doc = buildOpenApiDocument([contract], { version: "uji" });
  const op = doc.paths?.["/api/v1/uji/{id}"]?.post;
  assert.ok(op?.requestBody);
  assert.deepEqual(op?.security, [{ bearerAuth: [] }]);
  assert.ok(op?.responses?.["201"] && op.responses["401"] && op.responses["403"] && op.responses["429"]);
  assert.match(JSON.stringify(op?.responses?.["422"]), /KODE_UJI/);
  const publicDoc = buildOpenApiDocument([{ ...contract, id: "ujiPublik", action: "public", bodyType: "multipart", binary: true }], { version: "uji" });
  assert.deepEqual(publicDoc.paths?.["/api/v1/uji/{id}"]?.post?.security, []);
});

test("label enum mencakup kategori pengumuman & status absensi", () => {
  assert.equal(ENUM_LABELS.NotificationCategory.STUDENT_AFFAIRS, "Kesiswaan");
  assert.equal(ENUM_LABELS.AttendanceStatus.ALPHA, "Alpha");
});
