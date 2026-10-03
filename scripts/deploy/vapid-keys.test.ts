import { test } from "node:test";
import assert from "node:assert/strict";
import { generateVapidKeys } from "../../src/lib/push/web/vapid-keys";
import { vapidKeysAction } from "./vapid-keys-rules";

test("tanpa kunci / kosong -> buat (kode 3) tepat dua baris yang diterima web-push", async () => {
  for (const env of [{}, { VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "" }, { VAPID_PUBLIC_KEY: "  " }]) {
    const action = vapidKeysAction(env);
    assert.equal(action.code, 3);
    if (action.code !== 3) continue;
    const lines = action.lines.split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0]!, /^VAPID_PUBLIC_KEY=[A-Za-z0-9_-]{87}$/);
    assert.match(lines[1]!, /^VAPID_PRIVATE_KEY=[A-Za-z0-9_-]{43}$/);
    const webpush = (await import("web-push")).default;
    const [pub, priv] = lines.map((line) => line.split("=")[1]!);
    const headers = webpush.getVapidHeaders("https://fcm.googleapis.com", "https://studenthub.id", pub!, priv!, "aes128gcm");
    assert.match(String(headers.Authorization), /^vapid t=/);
  }
});

test("pasangan sah -> tidak diubah (kode 0); sebagian / rusak -> berhenti (kode 2)", () => {
  const keys = generateVapidKeys();
  assert.deepEqual(vapidKeysAction({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey }), { code: 0 });
  assert.equal(vapidKeysAction({ VAPID_PUBLIC_KEY: keys.publicKey }).code, 2);
  assert.equal(vapidKeysAction({ VAPID_PRIVATE_KEY: keys.privateKey }).code, 2);
  assert.equal(vapidKeysAction({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: "rusak" }).code, 2);
});
