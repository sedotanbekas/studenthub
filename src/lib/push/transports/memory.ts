import type { PushMessage, PushTicket, PushTransport } from "../types";

/**
 * Transport `memory` (test & CI): mencatat pesan yang "terkirim" dan bisa diskenariokan gagal —
 * tiket error per pesan (mis. DeviceNotRegistered) atau error level request (mis. statusCode 503).
 */
export type TicketScript = (message: PushMessage) => PushTicket | undefined;
export type RequestFailure = (messages: readonly PushMessage[]) => Error | null;

export interface MemoryPushTransport extends PushTransport {
  readonly name: "memory";
  /** Salinan pesan dari request yang tidak dilempar, urut kirim. */
  sent(): readonly PushMessage[];
  /** Jumlah pemanggilan send (termasuk yang dilempar). */
  requestCount(): number;
  setTicketScript(script: TicketScript | null): void;
  setRequestFailure(failure: RequestFailure | null): void;
  reset(): void;
}

export function createMemoryTransport(): MemoryPushTransport {
  let sent: readonly PushMessage[] = [];
  let requests = 0;
  let ticketScript: TicketScript | null = null;
  let requestFailure: RequestFailure | null = null;
  let seq = 0;

  return {
    name: "memory",
    async send(messages) {
      requests += 1;
      const failure = requestFailure?.(messages) ?? null;
      if (failure) throw failure;
      sent = [...sent, ...messages];
      return messages.map((message): PushTicket => {
        seq += 1;
        return ticketScript?.(message) ?? { status: "ok", id: `memory-${seq}` };
      });
    },
    sent: () => [...sent],
    requestCount: () => requests,
    setTicketScript(script) {
      ticketScript = script;
    },
    setRequestFailure(failure) {
      requestFailure = failure;
    },
    reset() {
      sent = [];
      requests = 0;
      ticketScript = null;
      requestFailure = null;
    },
  };
}

/** Instans bersama proses (dipilih getPushTransport saat PUSH_TRANSPORT=memory). */
export const memoryPushTransport: MemoryPushTransport = createMemoryTransport();
