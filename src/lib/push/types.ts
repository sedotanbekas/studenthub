/** Tipe transport push (Expo / log / memory). Sengaja tidak bergantung pada expo-server-sdk. */

export type PushTransportName = "expo" | "log" | "memory";

export interface PushData {
  readonly notificationId: string;
  readonly screen: string;
  readonly id: string;
}

/** Format pesan Expo yang dipakai aplikasi (satu token per pesan). */
export interface PushMessage {
  readonly to: string;
  readonly title: string;
  readonly body: string;
  readonly data: PushData;
  readonly sound: "default";
  readonly priority: "high";
  readonly channelId: "default";
}

export type PushTicket =
  | { readonly status: "ok"; readonly id?: string }
  | { readonly status: "error"; readonly message?: string; readonly details?: { readonly error?: string } };

export interface PushTransport {
  readonly name: PushTransportName;
  /**
   * Kirim pesan (dispatcher memecah per <= 100). Tiket ke-n milik pesan ke-n. Kegagalan level request
   * (jaringan, HTTP 429/5xx/4xx) dilempar sebagai Error dengan `statusCode` opsional.
   */
  send(messages: readonly PushMessage[]): Promise<readonly PushTicket[]>;
}
