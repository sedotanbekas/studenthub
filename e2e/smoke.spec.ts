import { expect, test } from "@playwright/test";

const basic = (credentials: string) => `Basic ${Buffer.from(credentials).toString("base64")}`;
const docsAuth = process.env.DOCS_BASIC_AUTH;

test("health melaporkan db & storage ok beserta versi", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ status: "ok", db: "ok", storage: "ok" });
  expect(typeof body.version).toBe("string");
});

test("label enum publik memakai envelope", async ({ request }) => {
  const res = await request.get("/api/v1/meta/enums");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.data.AttendanceStatus.HADIR).toBe("Hadir");
});

test("wilayah membutuhkan login", async ({ request }) => {
  const res = await request.get("/api/v1/regions/provinces");
  expect(res.status()).toBe(401);
  expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
});

test("dokumen OpenAPI dilindungi Basic auth bila dikonfigurasi", async ({ request }) => {
  test.skip(!docsAuth, "DOCS_BASIC_AUTH tidak disetel");
  expect((await request.get("/api/v1/openapi.json")).status()).toBe(401);
  const res = await request.get("/api/v1/openapi.json", { headers: { Authorization: basic(docsAuth as string) } });
  expect(res.status()).toBe(200);
  expect((await res.json()).openapi).toBe("3.1.0");
});
