import "./zod-setup";
import { after, type NextRequest } from "next/server";
import type { z } from "zod";
import { getAuth } from "@/lib/auth/get-auth";
import type { ActionContext, Principal } from "@/lib/auth/principal";
import { authorize } from "@/lib/auth/policy";
import { getEnv } from "@/lib/env";
import { log, safeErrorFields } from "@/lib/log";
import { readJsonBody, readMultipart, formDataToObject } from "./body";
import { clientIp, rateLimitKeyForIp } from "./client-ip";
import type { AnyContract, RouteHandler, RouteInput } from "./contract";
import { fail, ok } from "./envelope";
import { AppError, badRequest, tooManyRequests, unauthorized } from "./errors";
import { isCheckViolation, mapPrismaError } from "./prisma-errors";
import { getLimiter } from "./rate-limits";
import { requestIdOf, userAgentOf } from "./request-meta";

type Segment = { params: Promise<Record<string, string | string[] | undefined>> };

const DEFAULT_JSON_MAX = 262_144;
const DEFAULT_MULTIPART_MAX = 10 * 1024 * 1024;
const BASE_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

/**
 * Pipeline tunggal semua route /api/v1: requestId -> auth -> authorize(POLICY) -> rate limit
 * -> validasi zod -> handler -> envelope -> log. Error apa pun dipetakan ke envelope gagal.
 */
export function defineRoute<C extends AnyContract>(contract: C, handler: RouteHandler<C>) {
  return async function route(req: NextRequest, segment: Segment): Promise<Response> {
    const started = performance.now();
    const requestId = requestIdOf(req);
    const deferred: Array<() => Promise<void>> = [];
    let principal: Principal | null = null;
    let response: Response;
    try {
      const now = new Date();
      principal = await authenticate(contract, req, now);
      applyRateLimit(contract, req, principal);
      const input = await parseInput(contract, req, segment);
      const ctx = buildContext(req, principal, now, requestId, deferred);
      const result = await handler(input, ctx);
      response = toResponse(contract, result, requestId);
      await flushDeferred(deferred);
    } catch (error) {
      response = errorResponse(error, requestId);
    }
    logRequest(req, contract, response.status, started, requestId, principal);
    return response;
  };
}

async function authenticate(contract: AnyContract, req: Request, now: Date): Promise<Principal | null> {
  if (contract.action === "public") {
    // Route publik (login, refresh) tetap bisa dipakai walau klien mengirim token kedaluwarsa.
    try {
      return await getAuth(req, now);
    } catch (error) {
      if (error instanceof AppError && error.status === 401) return null;
      throw error;
    }
  }
  const principal = await getAuth(req, now);
  if (!principal) throw unauthorized("UNAUTHENTICATED", "Silakan login terlebih dahulu.");
  authorize(principal, contract.action);
  return principal;
}

function applyRateLimit(contract: AnyContract, req: Request, principal: Principal | null): void {
  if (!contract.rateLimit) return;
  const limiter = getLimiter(contract.rateLimit.limiter);
  const key = contract.rateLimit.key === "user" && principal ? `u:${principal.userId}` : `ip:${rateLimitKeyForIp(clientIp(req))}`;
  const verdict = limiter.check(key);
  if (!verdict.ok) throw tooManyRequests(verdict.retryAfterSeconds);
  limiter.hit(key);
}

function validate<S extends z.ZodType>(schema: S, value: unknown, where: string): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const details = result.error.issues.map((issue) => ({ path: [where, ...issue.path].join("."), code: issue.code, message: issue.message }));
  throw badRequest("VALIDATION_FAILED", details[0]?.message ?? "Data tidak valid.", details);
}

async function parseInput<C extends AnyContract>(contract: C, req: NextRequest, segment: Segment): Promise<RouteInput<C>> {
  const params = contract.params ? validate(contract.params, await segment.params, "params") : undefined;
  const query = contract.query ? validate(contract.query, Object.fromEntries(req.nextUrl.searchParams), "query") : undefined;
  let body: unknown = undefined;
  if (contract.body && contract.bodyType === "multipart") {
    const form = await readMultipart(req, contract.maxBodyBytes ?? DEFAULT_MULTIPART_MAX);
    body = validate(contract.body, formDataToObject(form), "body");
  } else if (contract.body) {
    body = validate(contract.body, await readJsonBody(req, contract.maxBodyBytes ?? DEFAULT_JSON_MAX), "body");
  }
  return { params, query, body, req } as RouteInput<C>;
}

function buildContext(req: Request, principal: Principal | null, now: Date, requestId: string, deferred: Array<() => Promise<void>>): ActionContext {
  return {
    principal,
    now,
    requestId,
    ip: clientIp(req),
    userAgent: userAgentOf(req),
    defer: (task) => {
      deferred.push(task);
    },
  };
}

function toResponse(contract: AnyContract, result: Awaited<ReturnType<RouteHandler<AnyContract>>>, requestId: string): Response {
  if (result instanceof Response) {
    result.headers.set("X-Request-Id", requestId);
    return result;
  }
  if (process.env.NODE_ENV === "test") assertResponseShape(contract, result.data);
  const status = result.status ?? contract.successStatus ?? 200;
  return Response.json(ok(result.data, result.meta), {
    status,
    headers: { ...BASE_HEADERS, ...result.headers, "X-Request-Id": requestId },
  });
}

function assertResponseShape(contract: AnyContract, data: unknown): void {
  const parsed = contract.response.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Respons ${contract.id} tidak sesuai kontrak: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`);
  }
}

async function flushDeferred(tasks: Array<() => Promise<void>>): Promise<void> {
  if (tasks.length === 0) return;
  const run = async () => {
    const results = await Promise.allSettled(tasks.map((task) => task()));
    for (const r of results) if (r.status === "rejected") log.error("defer.failed", safeErrorFields(r.reason));
  };
  if (getEnv().DEFER_MODE === "inline") await run();
  else after(run);
}

export function errorResponse(error: unknown, requestId: string): Response {
  const appError = error instanceof AppError ? error : mapPrismaError(error);
  if (appError) {
    return Response.json(fail(appError.code, appError.message, appError.details, requestId), {
      status: appError.status,
      headers: { ...BASE_HEADERS, ...appError.headers, "X-Request-Id": requestId },
    });
  }
  const kind = isCheckViolation(error) ? "check.violation" : "unhandled.error";
  log.error(kind, { requestId, ...safeErrorFields(error) });
  return Response.json(fail("INTERNAL_ERROR", "Terjadi kesalahan pada server.", null, requestId), {
    status: 500,
    headers: { ...BASE_HEADERS, "X-Request-Id": requestId },
  });
}

function logRequest(req: NextRequest, contract: AnyContract, status: number, started: number, requestId: string, principal: Principal | null): void {
  log.info("request", {
    requestId,
    method: req.method,
    route: contract.path,
    status,
    ms: Math.round(performance.now() - started),
    userId: principal?.userId,
    role: principal?.role,
    schoolId: principal?.schoolId ?? undefined,
  });
}
