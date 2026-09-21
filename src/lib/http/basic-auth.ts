import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string): Buffer => createHash("sha256").update(value).digest();

/** Cocokkan header Authorization: Basic dengan "user:password" yang diharapkan (waktu konstan). */
export function checkBasicAuth(header: string | null, expected: string): boolean {
  if (!header || !/^Basic\s+/i.test(header)) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(header.replace(/^Basic\s+/i, "").trim(), "base64").toString("utf8");
  } catch {
    return false;
  }
  return timingSafeEqual(digest(decoded), digest(expected));
}

export function basicAuthChallenge(): Response {
  return new Response("Autentikasi diperlukan.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Student Hub Docs", charset="UTF-8"', "Cache-Control": "no-store" },
  });
}

/** null = lolos; Response = tantangan 401. Tanpa DOCS_BASIC_AUTH (dev) halaman terbuka. */
export function guardDocs(req: Request, expected: string | undefined): Response | null {
  if (!expected) return null;
  return checkBasicAuth(req.headers.get("authorization"), expected) ? null : basicAuthChallenge();
}
