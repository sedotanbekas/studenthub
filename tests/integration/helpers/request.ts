/**
 * Memanggil route handler App Router langsung (tanpa server HTTP): membangun NextRequest,
 * meneruskan `{ params: Promise }` seperti Next 16, lalu mem-parse respons JSON.
 *
 *   const res = await callRoute<Envelope<{ id: string }>>(GET, {
 *     method: "GET", url: "/api/v1/school/students/abc", params: { id: "abc" }, bearer: token,
 *   });
 *   assert.equal(res.status, 200);
 */
import { NextRequest } from "next/server";

const TEST_ORIGIN = "http://localhost";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
export type RouteParams = Readonly<Record<string, string | string[]>>;

/**
 * Handler route apa pun: `(req)` atau `(req, { params })`. `Promise<never>` membuat handler
 * dengan tipe params spesifik (mis. `{ id: string }`) tetap dapat diterima.
 */
export type AnyRouteHandler = (request: NextRequest, context: { params: Promise<never> }) => Response | Promise<Response>;

/** Bentuk envelope API (src/lib/http/envelope.ts) dari sudut pandang test. */
export interface Envelope<T = unknown> {
  readonly success: boolean;
  readonly data: T;
  readonly error: { readonly code: string; readonly message: string; readonly details: unknown; readonly requestId: string | null } | null;
  readonly meta: Record<string, unknown> | null;
}

export interface CallRouteOptions {
  readonly method: HttpMethod;
  /** Path ("/api/v1/...") atau URL absolut. Path dilengkapi origin http://localhost. */
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Body JSON (Content-Type application/json diisi otomatis). Tidak boleh bersama formData. */
  readonly json?: unknown;
  /** Body multipart (boundary diisi otomatis oleh Request). */
  readonly formData?: FormData;
  /** Access token -> header Authorization: Bearer <token>. */
  readonly bearer?: string;
  /** Parameter segmen dinamis, mis. { id: "..." }. Default {}. */
  readonly params?: RouteParams;
}

export interface RouteResult<TBody> {
  readonly status: number;
  readonly headers: Headers;
  /** JSON hasil parse bila Content-Type JSON dan body tidak kosong; selain itu null. */
  readonly body: TBody | null;
  /** Respons asli. Body-nya belum dibaca bila bukan JSON (mis. unduhan berkas). */
  readonly response: Response;
}

function buildRequest(options: CallRouteOptions): NextRequest {
  if (options.json !== undefined && options.formData !== undefined) {
    throw new Error("callRoute: json dan formData tidak boleh dipakai bersamaan");
  }
  const headers = new Headers(options.headers);
  if (options.bearer !== undefined) headers.set("authorization", `Bearer ${options.bearer}`);
  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    body = JSON.stringify(options.json);
  } else if (options.formData !== undefined) {
    body = options.formData;
  }
  return new NextRequest(new URL(options.url, TEST_ORIGIN), { method: options.method, headers, body });
}

function isJson(response: Response): boolean {
  const type = response.headers.get("content-type") ?? "";
  return /^application\/(?:[\w.+-]+\+)?json\b/i.test(type);
}

async function parseBody<TBody>(response: Response): Promise<TBody | null> {
  if (!isJson(response)) return null;
  const text = await response.text();
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text) as TBody;
  } catch {
    throw new Error(`callRoute: respons ber-Content-Type JSON tetapi body bukan JSON valid (status ${response.status})`);
  }
}

/** Jalankan handler route dan kembalikan status, header, dan body JSON. */
export async function callRoute<TBody = Envelope>(
  handler: AnyRouteHandler,
  options: CallRouteOptions,
): Promise<RouteResult<TBody>> {
  const request = buildRequest(options);
  const params = Promise.resolve(options.params ?? {}) as Promise<never>;
  const response = await handler(request, { params });
  const body = await parseBody<TBody>(response);
  return { status: response.status, headers: response.headers, body, response };
}
