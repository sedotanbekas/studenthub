import { randomUUID } from "node:crypto";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** X-Request-Id klien dipakai bila formatnya aman; selain itu dibuat baru. */
export function requestIdOf(req: Request): string {
  const incoming = req.headers.get("x-request-id");
  return incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
}

export function userAgentOf(req: Request): string | null {
  const ua = req.headers.get("user-agent");
  return ua ? ua.slice(0, 255) : null;
}
