import { before, test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";

/**
 * Hanya jalur 404 yang diuji di unit test (tanpa DB). Jalur 'tick' menyentuh JobRun lewat
 * runKeyedJob sehingga diuji di integration test.
 */
const SECRET = "job-secret-unit-test-0123456789abcdef";

type PostHandler = (req: Request, ctx: { params: Promise<{ job: string }> }) => Promise<Response>;
let POST: PostHandler;

before(async () => {
  Object.assign(process.env, {
    DATABASE_URL: process.env.DATABASE_URL ?? "mysql://unit:unit@127.0.0.1:3307/studenthub_unit_test",
    JWT_ACCESS_SECRET: "jwt-secret-unit-test-0123456789abcdef",
    AD_EVENT_SECRET: "ad-event-secret-unit-test-0123456789ab",
    JOB_SECRET: SECRET,
    APP_ORIGIN: "http://localhost:3030",
    PUBLIC_MEDIA_BASE_URL: "http://localhost:3030/media",
    STORAGE_ROOT: tmpdir(),
  });
  const { resetEnvCache } = await import("@/lib/env");
  resetEnvCache();
  ({ POST } = await import("./route"));
});

const call = (job: string, headers: Record<string, string> = {}): Promise<Response> =>
  POST(new Request(`http://127.0.0.1:3020/api/internal/jobs/${job}`, { method: "POST", headers }), {
    params: Promise.resolve({ job }),
  });

async function assertNotFound(res: Response): Promise<void> {
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(await res.json(), {
    success: false,
    data: null,
    error: { code: "NOT_FOUND", message: "Tidak ditemukan.", details: null, requestId: null },
    meta: null,
  });
}

test("POST tick dengan X-Real-IP → 404 walau secret benar", async () => {
  await assertNotFound(await call("tick", { "x-job-secret": SECRET, "x-real-ip": "198.51.100.7" }));
});

test("POST tick tanpa secret → 404", async () => {
  await assertNotFound(await call("tick"));
});

test("POST tick dengan secret salah → 404", async () => {
  await assertNotFound(await call("tick", { "x-job-secret": "bukan-secret-yang-benar-0123456789abcdef" }));
});

test("POST job tak dikenal dengan secret benar → 404", async () => {
  await assertNotFound(await call("hapus-semua", { "x-job-secret": SECRET }));
});
