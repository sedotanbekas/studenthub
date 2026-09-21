import "@/lib/http/zod-setup";
import { createDocument, type ZodOpenApiOperationObject, type ZodOpenApiPathsObject } from "zod-openapi";
import type { AnyContract } from "@/lib/http/contract";
import { envelopeOf, errorEnvelopeSchema } from "./schemas";

const errorContent = { "application/json": { schema: errorEnvelopeSchema } };

function errorResponses(contract: AnyContract): ZodOpenApiOperationObject["responses"] {
  const domainCodes = contract.errors?.length ? ` Kode domain: ${contract.errors.join(", ")}.` : "";
  const responses: ZodOpenApiOperationObject["responses"] = {
    "400": { description: "VALIDATION_FAILED / INVALID_JSON.", content: errorContent },
    "404": { description: "NOT_FOUND (termasuk data milik sekolah lain).", content: errorContent },
    "409": { description: `Konflik status/duplikat.${domainCodes}`, content: errorContent },
    "422": { description: `Pelanggaran aturan bisnis.${domainCodes}`, content: errorContent },
    "500": { description: "INTERNAL_ERROR.", content: errorContent },
  };
  if (contract.action !== "public") {
    responses["401"] = { description: "UNAUTHENTICATED / TOKEN_EXPIRED / SESSION_INVALID / ACCOUNT_INACTIVE.", content: errorContent };
    responses["403"] = { description: "FORBIDDEN / PASSWORD_CHANGE_REQUIRED / SCOPE_MISMATCH / status akun.", content: errorContent };
  }
  if (contract.rateLimit || contract.errors?.includes("RATE_LIMITED")) responses["429"] = { description: "RATE_LIMITED (lihat header Retry-After).", content: errorContent };
  return responses;
}

function requestBody(contract: AnyContract): ZodOpenApiOperationObject["requestBody"] {
  if (!contract.body) return undefined;
  const type = contract.bodyType === "multipart" ? "multipart/form-data" : "application/json";
  return { required: true, content: { [type]: { schema: contract.body } } };
}

function successResponse(contract: AnyContract): ZodOpenApiOperationObject["responses"] {
  const status = String(contract.successStatus ?? 200);
  if (contract.binary) return { [status]: { description: "Berkas biner." } };
  const content = { "application/json": { schema: envelopeOf(contract.response, contract.pagination) } };
  return { [status]: { description: "Berhasil.", content } };
}

function toOperation(contract: AnyContract): ZodOpenApiOperationObject {
  const policyNote = contract.action === "public" ? "Publik." : `Aksi POLICY: \`${contract.action}\`.`;
  return {
    operationId: contract.id,
    tags: [contract.tag],
    summary: contract.summary,
    description: [contract.description, policyNote].filter(Boolean).join("\n\n"),
    security: contract.action === "public" ? [] : [{ bearerAuth: [] }],
    requestParams: {
      ...(contract.params ? { path: contract.params } : {}),
      ...(contract.query ? { query: contract.query } : {}),
    },
    ...(contract.body ? { requestBody: requestBody(contract) } : {}),
    responses: { ...successResponse(contract), ...errorResponses(contract) },
  };
}

export function buildOpenApiDocument(contracts: readonly AnyContract[], options: { version: string; serverUrl?: string }) {
  const paths: ZodOpenApiPathsObject = {};
  for (const contract of contracts) {
    const method = contract.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";
    paths[contract.path] = { ...(paths[contract.path] ?? {}), [method]: toOperation(contract) };
  }
  return createDocument({
    openapi: "3.1.0",
    info: {
      title: "Student Hub API",
      version: options.version,
      description: "API manajemen sekolah multi-sekolah: siswa, admin sekolah, sponsor, super admin. Semua respons memakai envelope {success, data, error, meta}.",
    },
    servers: options.serverUrl ? [{ url: options.serverUrl }] : undefined,
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "Access token dari POST /api/v1/auth/login." } },
    },
    paths,
  });
}
