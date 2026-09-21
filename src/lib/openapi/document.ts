import "@/lib/http/zod-setup";
import { createDocument, type ZodOpenApiOperationObject, type ZodOpenApiPathsObject } from "zod-openapi";
import type { AnyContract } from "@/lib/http/contract";
import { statusForCode } from "@/lib/http/error-status";
import { envelopeOf, errorEnvelopeSchema } from "./schemas";

const errorContent = { "application/json": { schema: errorEnvelopeSchema } };

const STATUS_DESCRIPTIONS: Readonly<Record<number, string>> = {
  400: "Permintaan tidak valid.",
  401: "Tidak terautentikasi.",
  403: "Akses ditolak.",
  404: "Data tidak ditemukan (termasuk data milik sekolah lain).",
  409: "Konflik status/duplikat.",
  410: "Berkas sudah tidak tersedia.",
  411: "Header Content-Length wajib.",
  413: "Body melebihi batas ukuran.",
  415: "Content-Type tidak didukung.",
  422: "Pelanggaran aturan bisnis.",
  429: "Terlalu banyak permintaan (lihat header Retry-After).",
  500: "Kesalahan server.",
  503: "Layanan sedang tidak tersedia.",
};

/** Kode dari pipeline defineRoute untuk setiap operasi terautentikasi. */
const AUTHENTICATED_CODES = ["UNAUTHENTICATED", "TOKEN_EXPIRED", "SESSION_INVALID", "ACCOUNT_INACTIVE", "FORBIDDEN", "PASSWORD_CHANGE_REQUIRED", "SCOPE_MISMATCH"];

/** Kode umum dari pipeline (validasi, auth, body, rate limit) sesuai bentuk kontrak. */
function pipelineCodes(contract: AnyContract): string[] {
  const multipart = contract.body !== undefined && contract.bodyType === "multipart";
  const bodyCodes = contract.body ? [multipart ? "INVALID_MULTIPART" : "INVALID_JSON", "PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE"] : [];
  return [
    "VALIDATION_FAILED",
    "NOT_FOUND",
    "INTERNAL_ERROR",
    ...(contract.action === "public" ? [] : AUTHENTICATED_CODES),
    ...bodyCodes,
    ...(multipart ? ["LENGTH_REQUIRED"] : []),
    ...(contract.rateLimit ? ["RATE_LIMITED"] : []),
  ];
}

/** Kode dikelompokkan per status HTTP (statusForCode); setiap status muncul sekali, kode unik. */
function codesByStatus(contract: AnyContract): Map<number, string[]> {
  const groups = new Map<number, string[]>();
  for (const code of new Set([...pipelineCodes(contract), ...(contract.errors ?? [])])) {
    const status = statusForCode(code);
    groups.set(status, [...(groups.get(status) ?? []), code]);
  }
  return groups;
}

function errorResponses(contract: AnyContract): ZodOpenApiOperationObject["responses"] {
  const entries = [...codesByStatus(contract)]
    .sort(([a], [b]) => a - b)
    .map(([status, codes]) => {
      const base = STATUS_DESCRIPTIONS[status] ?? "Error.";
      return [String(status), { description: `${base} Kode: ${codes.join(", ")}.`, content: errorContent }] as const;
    });
  return Object.fromEntries(entries);
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
