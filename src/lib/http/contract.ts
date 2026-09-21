import type { z } from "zod";
import type { Action } from "@/lib/auth/policy";
import type { ActionContext } from "@/lib/auth/principal";
import type { getLimiter } from "./rate-limits";
import type { Meta } from "./envelope";

/**
 * Kontrak route = satu-satunya sumber kebenaran untuk validasi runtime DAN dokumentasi OpenAPI.
 * Path memakai gaya OpenAPI: /api/v1/schools/{id}.
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type LimiterName = Parameters<typeof getLimiter>[0];

export interface RouteContract<
  P extends z.ZodType | undefined = z.ZodType | undefined,
  Q extends z.ZodType | undefined = z.ZodType | undefined,
  B extends z.ZodType | undefined = z.ZodType | undefined,
  R extends z.ZodType = z.ZodType,
> {
  readonly id: string;
  readonly method: HttpMethod;
  readonly path: `/api/v1/${string}`;
  readonly tag: string;
  readonly summary: string;
  readonly description?: string;
  /** "public" = tanpa autentikasi. */
  readonly action: Action | "public";
  readonly params?: P;
  readonly query?: Q;
  readonly body?: B;
  readonly bodyType?: "json" | "multipart";
  /** Batas ukuran body (byte). Default JSON 256 KiB, multipart 10 MiB. */
  readonly maxBodyBytes?: number;
  readonly response: R;
  readonly successStatus?: 200 | 201;
  readonly pagination?: "page" | "cursor";
  /** Kode error domain yang mungkin dikembalikan (untuk dokumentasi). */
  readonly errors?: readonly string[];
  readonly rateLimit?: { readonly limiter: LimiterName; readonly key: "ip" | "user" };
  /** Respons biner (unduhan berkas): handler mengembalikan Response langsung. */
  readonly binary?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyContract = RouteContract<any, any, any, any>;

type Out<T> = T extends z.ZodType ? z.output<T> : undefined;

export type RouteInput<C extends AnyContract> = {
  params: Out<C["params"]>;
  query: Out<C["query"]>;
  body: Out<C["body"]>;
  req: Request;
};

export type RouteSuccess<C extends AnyContract> = {
  data: z.input<C["response"]>;
  meta?: Meta | null;
  status?: number;
  headers?: Record<string, string>;
};

export type RouteHandler<C extends AnyContract> = (
  input: RouteInput<C>,
  ctx: ActionContext,
) => Promise<RouteSuccess<C> | Response>;

/** Identitas untuk inferensi tipe literal kontrak. */
export function defineContract<const C extends AnyContract>(contract: C): C {
  return contract;
}
