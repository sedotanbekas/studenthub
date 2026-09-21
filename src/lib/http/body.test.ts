import { test } from "node:test";
import assert from "node:assert/strict";
import { isAppError } from "./errors";
import { formDataToObject, JSON_BODY_MAX_BYTES, MAX_MULTIPART_BYTES, readJsonBody, readMultipart } from "./body";

const URL_ = "http://127.0.0.1:3030/api/v1/x";

function jsonReq(body: BodyInit | null, headers: Record<string, string> = { "content-type": "application/json" }): Request {
  return new Request(URL_, { method: "POST", headers, body });
}

function streamOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function multipartReq(fd: FormData, overrides: Record<string, string | null> = {}): Promise<Request> {
  const encoded = new Response(fd);
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  const base: Record<string, string | null> = {
    "content-type": encoded.headers.get("content-type"),
    "content-length": String(bytes.byteLength),
    ...overrides,
  };
  const headers = Object.fromEntries(Object.entries(base).filter((e): e is [string, string] => e[1] !== null));
  return new Request(URL_, { method: "POST", headers, body: bytes });
}

async function assertAppError(promise: Promise<unknown>, status: number, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(isAppError(error), `bukan AppError: ${String(error)}`);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

test("readJsonBody mem-parse JSON valid (charset boleh)", async () => {
  assert.deepEqual(await readJsonBody(jsonReq('{"a":1,"b":["x"]}')), { a: 1, b: ["x"] });
  const withCharset = jsonReq('{"a":2}', { "content-type": "Application/JSON; charset=utf-8" });
  assert.deepEqual(await readJsonBody(withCharset), { a: 2 });
});

test("readJsonBody: body kosong → {}", async () => {
  assert.deepEqual(await readJsonBody(jsonReq(null)), {});
  assert.deepEqual(await readJsonBody(jsonReq("")), {});
  assert.deepEqual(await readJsonBody(jsonReq("  \n ")), {});
});

test("readJsonBody: content-type selain application/json → 415", async () => {
  await assertAppError(readJsonBody(jsonReq('{"a":1}', { "content-type": "text/plain" })), 415, "UNSUPPORTED_MEDIA_TYPE");
  await assertAppError(readJsonBody(jsonReq("a=1", { "content-type": "application/x-www-form-urlencoded" })), 415, "UNSUPPORTED_MEDIA_TYPE");
  await assertAppError(readJsonBody(jsonReq('{"a":1}', { "content-type": "application/jsonx" })), 415, "UNSUPPORTED_MEDIA_TYPE");
  await assertAppError(readJsonBody(jsonReq('{"a":1}', {})), 415, "UNSUPPORTED_MEDIA_TYPE");
});

test("readJsonBody: JSON rusak → 400 INVALID_JSON", async () => {
  await assertAppError(readJsonBody(jsonReq("{a:1}")), 400, "INVALID_JSON");
  await assertAppError(readJsonBody(jsonReq('{"a":')), 400, "INVALID_JSON");
  const invalidUtf8 = new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]);
  await assertAppError(readJsonBody(jsonReq(invalidUtf8)), 400, "INVALID_JSON");
});

test("readJsonBody: Content-Length melebihi batas → 413 sebelum membaca", async () => {
  const req = jsonReq('{"a":1}', { "content-type": "application/json", "content-length": String(JSON_BODY_MAX_BYTES + 1) });
  await assertAppError(readJsonBody(req), 413, "PAYLOAD_TOO_LARGE");
  assert.equal(req.bodyUsed, false);
});

test("readJsonBody: Content-Length berbohong → dihentikan saat hitungan byte melewati batas", async () => {
  const big = JSON.stringify({ data: "x".repeat(200) });
  const lying = jsonReq(big, { "content-type": "application/json", "content-length": "10" });
  await assertAppError(readJsonBody(lying, 100), 413, "PAYLOAD_TOO_LARGE");
});

test("readJsonBody: stream tanpa Content-Length dihitung per chunk", async () => {
  const chunks = Array.from({ length: 10 }, () => "x".repeat(50));
  const req = new Request(URL_, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: streamOf(['{"d":"', ...chunks, '"}']),
    duplex: "half",
  } as RequestInit);
  await assertAppError(readJsonBody(req, 300), 413, "PAYLOAD_TOO_LARGE");
  const small = new Request(URL_, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: streamOf(['{"d":', '"ok"}']),
    duplex: "half",
  } as RequestInit);
  assert.deepEqual(await readJsonBody(small, 300), { d: "ok" });
});

test("readJsonBody: tepat di batas diterima", async () => {
  const body = JSON.stringify({ d: "x".repeat(92) });
  assert.equal(Buffer.byteLength(body), 100);
  assert.deepEqual(await readJsonBody(jsonReq(body), 100), { d: "x".repeat(92) });
});

test("readMultipart mengembalikan FormData", async () => {
  const fd = new FormData();
  fd.append("latitude", "-6.2");
  fd.append("selfie", new File([new Uint8Array([1, 2, 3])], "a.jpg", { type: "image/jpeg" }));
  const parsed = await readMultipart(await multipartReq(fd), 1024);
  assert.equal(parsed.get("latitude"), "-6.2");
  const file = parsed.get("selfie");
  assert.ok(file instanceof File);
  assert.equal(file.size, 3);
  assert.equal(MAX_MULTIPART_BYTES, 10_485_760);
});

test("readMultipart: tanpa Content-Length → 411", async () => {
  const fd = new FormData();
  fd.append("a", "1");
  await assertAppError(readMultipart(await multipartReq(fd, { "content-length": null }), 1024), 411, "LENGTH_REQUIRED");
  await assertAppError(readMultipart(await multipartReq(fd, { "content-length": "abc" }), 1024), 411, "LENGTH_REQUIRED");
});

test("readMultipart: Content-Length > maxBytes → 413 tanpa memanggil formData()", async () => {
  const fd = new FormData();
  fd.append("a", "x".repeat(500));
  const req = await multipartReq(fd);
  await assertAppError(readMultipart(req, 100), 413, "PAYLOAD_TOO_LARGE");
  assert.equal(req.bodyUsed, false);
});

test("readMultipart: Content-Length berbohong tetap dibatasi hitungan byte", async () => {
  const fd = new FormData();
  fd.append("a", "x".repeat(500));
  await assertAppError(readMultipart(await multipartReq(fd, { "content-length": "50" }), 100), 413, "PAYLOAD_TOO_LARGE");
});

test("readMultipart: content-type bukan multipart/form-data → 415", async () => {
  const req = new Request(URL_, { method: "POST", headers: { "content-type": "application/json", "content-length": "7" }, body: '{"a":1}' });
  await assertAppError(readMultipart(req, 1024), 415, "UNSUPPORTED_MEDIA_TYPE");
  const noType = new Request(URL_, { method: "POST", headers: { "content-length": "3" }, body: new Uint8Array([1, 2, 3]) });
  await assertAppError(readMultipart(noType, 1024), 415, "UNSUPPORTED_MEDIA_TYPE");
});

test("readMultipart: body multipart rusak → 400 INVALID_MULTIPART", async () => {
  const req = new Request(URL_, {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=zzz", "content-length": "12" },
    body: "bukan-multi!",
  });
  await assertAppError(readMultipart(req, 1024), 400, "INVALID_MULTIPART");
});

test("formDataToObject: kunci berulang menjadi array, tunggal tetap skalar", () => {
  const fd = new FormData();
  const file = new File(["abc"], "a.png", { type: "image/png" });
  fd.append("name", "Budi");
  fd.append("classIds", "c1");
  fd.append("classIds", "c2");
  fd.append("classIds", "c3");
  fd.append("attachment", file);
  const obj = formDataToObject(fd);
  assert.equal(obj.name, "Budi");
  assert.deepEqual(obj.classIds, ["c1", "c2", "c3"]);
  assert.ok(obj.attachment instanceof File);
});

test("formDataToObject: kunci __proto__ tidak mencemari prototype", () => {
  const fd = new FormData();
  fd.append("__proto__", "x");
  fd.append("constructor", "y");
  const obj = formDataToObject(fd);
  assert.equal(Object.getPrototypeOf(obj), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(obj, "__proto__")?.value, "x");
  assert.equal(({} as Record<string, unknown>).x, undefined);
});
