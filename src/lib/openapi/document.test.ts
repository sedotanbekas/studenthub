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

type Responses = Record<string, { description?: string } | undefined>;

function responsesOf(operationId: string): Responses {
  const doc = buildOpenApiDocument(ALL_CONTRACTS, { version: "uji" });
  for (const item of Object.values(doc.paths ?? {})) {
    for (const op of Object.values(item ?? {})) {
      const candidate = op as { operationId?: string; responses?: Responses } | undefined;
      if (candidate?.operationId === operationId) return candidate.responses ?? {};
    }
  }
  throw new Error(`operationId ${operationId} tidak ditemukan`);
}

test("authLogin (publik) mendokumentasikan 401 INVALID_CREDENTIALS & 403 TEMP_PASSWORD_EXPIRED", () => {
  const responses = responsesOf("authLogin");
  assert.match(responses["401"]?.description ?? "", /INVALID_CREDENTIALS/);
  assert.match(responses["403"]?.description ?? "", /TEMP_PASSWORD_EXPIRED/);
  assert.match(responses["400"]?.description ?? "", /DEVICE_ID_REQUIRED/);
  assert.match(responses["422"]?.description ?? "", /PUSH_TOKEN_WEB_SESSION/);
  assert.ok(responses["413"] && responses["415"] && responses["429"]);
});

test("authRefresh (publik) mendokumentasikan 401 SESSION_INVALID & 409 REFRESH_RACE", () => {
  const responses = responsesOf("authRefresh");
  assert.match(responses["401"]?.description ?? "", /SESSION_INVALID/);
  assert.match(responses["409"]?.description ?? "", /REFRESH_RACE/);
  assert.equal(responses["403"], undefined);
});

test("kode dikelompokkan per status: 409 dan 422 tidak lagi menduplikasi seluruh daftar", () => {
  const contract = defineContract({
    id: "ujiKelompok",
    method: "PATCH",
    path: "/api/v1/uji-kelompok/{id}",
    tag: "Uji",
    summary: "Uji",
    action: "region.read",
    body: z.object({ nama: z.string() }),
    response: z.object({ id: z.string() }),
    errors: ["NISN_LOCKED", "ACTIVATION_INCOMPLETE", "CLASS_NOT_FOUND", "KODE_BARU"],
  });
  const op = buildOpenApiDocument([contract], { version: "uji" }).paths?.["/api/v1/uji-kelompok/{id}"]?.patch;
  const responses = (op?.responses ?? {}) as Responses;
  const conflict = responses["409"]?.description ?? "";
  const unprocessable = responses["422"]?.description ?? "";
  assert.match(conflict, /NISN_LOCKED/);
  assert.doesNotMatch(conflict, /ACTIVATION_INCOMPLETE|KODE_BARU/);
  assert.match(unprocessable, /ACTIVATION_INCOMPLETE/);
  assert.match(unprocessable, /KODE_BARU/);
  assert.doesNotMatch(unprocessable, /NISN_LOCKED/);
  assert.match(responses["404"]?.description ?? "", /NOT_FOUND.*CLASS_NOT_FOUND|CLASS_NOT_FOUND.*NOT_FOUND/);
  assert.ok(responses["413"] && responses["415"]);
  assert.equal(responses["411"], undefined);
  assert.equal(responses["429"], undefined);
});

test("kontrak publik tanpa body/kode: hanya 400/404/500; multipart menambah 411", () => {
  const base = defineContract({
    id: "ujiPolos",
    method: "GET",
    path: "/api/v1/uji-polos",
    tag: "Uji",
    summary: "Uji",
    action: "public",
    response: z.object({ ok: z.boolean() }),
  });
  const plain = buildOpenApiDocument([base], { version: "uji" }).paths?.["/api/v1/uji-polos"]?.get;
  assert.deepEqual(Object.keys(plain?.responses ?? {}).sort(), ["200", "400", "404", "500"]);
  const upload = { ...base, id: "ujiUnggah", method: "POST" as const, body: z.object({ file: z.string() }), bodyType: "multipart" as const };
  const post = buildOpenApiDocument([upload], { version: "uji" }).paths?.["/api/v1/uji-polos"]?.post;
  assert.deepEqual(Object.keys(post?.responses ?? {}).sort(), ["200", "400", "404", "411", "413", "415", "500"]);
});
