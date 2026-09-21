import { randomUUID } from "node:crypto";
import { log } from "@/lib/log";
import type { PushTicket, PushTransport } from "../types";

export type LogLine = (message: string, fields: Record<string, unknown>) => void;

/**
 * Transport `log` (dev & staging sebelum akun EAS siap): satu baris log per pesan, hanya notificationId
 * dan judul — TANPA isi (bisa memuat data pribadi) dan tanpa token perangkat. Selalu tiket ok.
 */
export function createLogTransport(writeLine: LogLine = log.info): PushTransport {
  return {
    name: "log",
    async send(messages) {
      return messages.map((message): PushTicket => {
        writeLine("push.log", { notificationId: message.data.notificationId, title: message.title });
        return { status: "ok", id: `log-${randomUUID()}` };
      });
    },
  };
}
