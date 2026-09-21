import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { EXPO_HTTP_TIMEOUTS } from "../constants";
import { classifyRequestError } from "../rules";
import { createExpoClient, createExpoTransport } from "./expo";

/**
 * Klien Expo sungguhan (expo-server-sdk + undici) terhadap server lokal yang menerima koneksi tetapi tidak
 * pernah menjawab: request harus diputus oleh batas waktu header milik kita, bukan default undici 300 detik.
 * EXPO_BASE_URL dibaca SDK saat modul dimuat -> di-set sebelum import dinamis (proses test terpisah per berkas).
 */
let server: Server;
before(async () => {
  server = createServer(() => undefined);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.EXPO_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

const message = { to: "ExponentPushToken[uji]", title: "Judul", body: "Isi", data: { notificationId: "n1", screen: "invoice", id: "i1" }, sound: "default", priority: "high", channelId: "default" } as const;

test("batas waktu bawaan per request Expo jauh di bawah anggaran dispatcher (bukan 300 detik)", () => {
  assert.ok(EXPO_HTTP_TIMEOUTS.connectMs <= 10_000 && EXPO_HTTP_TIMEOUTS.headersMs <= 15_000 && EXPO_HTTP_TIMEOUTS.bodyMs <= 15_000);
});

test("server menggantung: request diputus batas waktu header -> error jaringan (retry), tidak menunggu 300 detik", async () => {
  const transport = createExpoTransport(() => createExpoClient({ timeouts: { connectMs: 500, headersMs: 300, bodyMs: 300 } }));
  const started = Date.now();
  const error = await transport.send([message]).then(() => null, (e: unknown) => e);
  const elapsed = Date.now() - started;
  assert.ok(error, "request harus gagal");
  assert.ok(elapsed < 5_000, `diputus dalam ${elapsed} ms`);
  assert.deepEqual(classifyRequestError(error), { kind: "retry", error: "NETWORK_ERROR" });
});
