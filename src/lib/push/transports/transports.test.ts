import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import { transportFor } from "../transport";
import type { PushMessage } from "../types";
import { createExpoTransport, fromExpoTicket } from "./expo";
import { createLogTransport } from "./log";
import { createMemoryTransport, memoryPushTransport } from "./memory";

const message = (n: number, to = `ExponentPushToken[t${n}]`): PushMessage => ({
  to,
  title: `Judul ${n}`,
  body: `Isi rahasia ${n}`,
  data: { notificationId: `n${n}`, screen: "invoice", id: `i${n}` },
  sound: "default",
  priority: "high",
  channelId: "default",
});

test("memory: mencatat pesan & tiket ok bawaan; salinan tidak bisa memutasi catatan", async () => {
  const transport = createMemoryTransport();
  const tickets = await transport.send([message(1), message(2)]);
  assert.deepEqual(tickets.map((t) => t.status), ["ok", "ok"]);
  const sent = transport.sent();
  assert.deepEqual(sent.map((m) => m.data.notificationId), ["n1", "n2"]);
  (sent as PushMessage[]).pop();
  assert.equal(transport.sent().length, 2);
});

test("memory: skenario tiket per pesan & kegagalan request, reset", async () => {
  const transport = createMemoryTransport();
  transport.setTicketScript((m) => (m.to.endsWith("[t1]") ? { status: "error", details: { error: "DeviceNotRegistered" } } : undefined));
  const tickets = await transport.send([message(1), message(2)]);
  assert.deepEqual(tickets.map((t) => t.status), ["error", "ok"]);
  transport.setRequestFailure(() => Object.assign(new Error("server"), { statusCode: 503 }));
  await assert.rejects(transport.send([message(3)]), /server/);
  assert.equal(transport.sent().length, 2, "request gagal tidak dicatat");
  assert.equal(transport.requestCount(), 2);
  transport.reset();
  assert.deepEqual([transport.sent().length, transport.requestCount()], [0, 0]);
  assert.equal((await transport.send([message(4)]))[0]?.status, "ok");
});

test("log: satu baris per pesan tanpa isi & token; tiket ok", async () => {
  const lines: string[] = [];
  const transport = createLogTransport((msg, fields) => lines.push(JSON.stringify({ msg, ...fields })));
  const tickets = await transport.send([message(1), message(2)]);
  assert.deepEqual(tickets.map((t) => t.status), ["ok", "ok"]);
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0] ?? "{}"), { msg: "push.log", notificationId: "n1", title: "Judul 1" });
  for (const line of lines) assert.doesNotMatch(line, /rahasia|ExponentPushToken/);
  assert.doesNotThrow(() => createLogTransport(), "bawaan memakai log.info");
});

test("expo: dipecah per 100 pesan, format pesan Expo, tiket dipetakan", async () => {
  const calls: ExpoPushMessage[][] = [];
  let loads = 0;
  const transport = createExpoTransport(async () => {
    loads += 1;
    return {
      async sendPushNotificationsAsync(batch) {
        calls.push(batch);
        return batch.map((m, i): ExpoPushTicket => (i === 0 ? { status: "error", message: `${String(m.to)} tidak terdaftar`, details: { error: "DeviceNotRegistered" } } : { status: "ok", id: `r${i}` }));
      },
    };
  });
  const tickets = await transport.send(Array.from({ length: 205 }, (_, i) => message(i)));
  assert.deepEqual(calls.map((c) => c.length), [100, 100, 5]);
  assert.equal(tickets.length, 205);
  assert.deepEqual(tickets[0], { status: "error", message: "ExponentPushToken[t0] tidak terdaftar", details: { error: "DeviceNotRegistered" } });
  assert.deepEqual(calls[0]?.[1], { to: "ExponentPushToken[t1]", title: "Judul 1", body: "Isi rahasia 1", data: { notificationId: "n1", screen: "invoice", id: "i1" }, sound: "default", priority: "high", channelId: "default" });
  await transport.send([message(1)]);
  assert.equal(loads, 1, "klien dibuat sekali");
});

test("expo: klien gagal dimuat -> dilempar dan dicoba lagi pada panggilan berikutnya", async () => {
  let attempt = 0;
  const transport = createExpoTransport(async () => {
    attempt += 1;
    if (attempt === 1) throw new Error("modul tidak ada");
    return { sendPushNotificationsAsync: async (batch) => batch.map((): ExpoPushTicket => ({ status: "ok", id: "x" })) };
  });
  await assert.rejects(transport.send([message(1)]), /modul tidak ada/);
  assert.equal((await transport.send([message(1)])).length, 1);
});

test("fromExpoTicket & transportFor", () => {
  assert.deepEqual(fromExpoTicket({ status: "ok", id: "r" }), { status: "ok", id: "r" });
  assert.deepEqual(fromExpoTicket({ status: "error", message: "m" }), { status: "error", message: "m", details: { error: undefined } });
  assert.equal(transportFor("memory"), memoryPushTransport);
  assert.equal(transportFor("log").name, "log");
  assert.equal(transportFor("expo").name, "expo");
});
