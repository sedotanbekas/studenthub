# N3: Web Push (PWA)

## 0. Revisi setelah kritik (2026-10-03) — berlaku di atas draf di bawah

Sumber: `N3-web-push.critique.md` + `00-integration.md` §2 (keputusan 5–9). Semua temuan diterima:

| # Kritik | Keputusan (sudah diimplementasikan) |
|---|---|
| 1 | (a) `WEB_PUSH_DISABLED`/`WEB_PUSH_APP_SESSION`/`WEB_PUSH_ENDPOINT_INVALID` = 422 di `error-status.ts`. (b) `initialPushStatus(_role)` selalu PENDING (parameter dipertahankan untuk pemanggil). (c) SW ES2019 (`catch {}` tanpa binding), lolos lint. (d) Urutan mode: tanpa kunci → mati; kunci rusak → mati; `PUSH_TRANSPORT=memory` → memori **tanpa** cek subjek; selain itu subjek wajib https bukan localhost / mailto. Pasangan kunci KHUSUS test di `tests/integration/setup.ts` & env CI. (e) Test N4 sudah memakai `initialPushStatus("SCHOOL_ADMIN")`; tx-notify/leave/submissions menerima PENDING atau SKIPPED NO_DEVICE. (f) e2e `pwa.spec.ts` memakai super admin CLI + ganti sandi awal. |
| 2 | Upsert: `lockUserSessions` (AppLock user) → `lockRows("AuthSession")` FOR UPDATE → baca ulang sesi hidup → hapus/upsert. Pencabutan sesi menghapus langganan SETELAH AuthSession diperbarui lewat satu pembantu `forgetRevokedWebPush(tx, whereSesi)` (revokeSession, revokeAllSessions, revokeSchoolSessions, sesi digantikan login, releaseGraduates). Urutan di `tx.ts`. Test balapan logout vs PUT. |
| 3 | Tanpa penanda per tab: `WebPushBridge` membaca status server setiap identitas berganti; `syncAction` (murni + test): izin ada & server belum punya baris → langganan ULANG (endpoint baru), kunci server berganti → langganan ulang. |
| 4 | Halaman = penulis kedua badge ikon (`appBadgeAction` dari snapshot N1); keluar → `clearAppBadge()` + tutup notifikasi tampil + `unsubscribe()`. |
| 5 | Fakta iPhone ditulis apa adanya: langkah pasang ke-3 menyebut akibat masuk lewat Safari; beban `NEW_DEVICE` (±5 catatan/siswa iPhone di minggu pertama → antrean B1 & rekap N4) dicatat di backlog + pertanyaan pemilik 4. |
| 6 | `webPathOf` memetakan layar yang benar-benar dipakai: admin `leave-request`/`attendance-day` → attendance, siswa `attendance-alpha` → my-leave, `check-in` (N5) → `/hub/my-attendance?absen=1&notif=…`. Test memindai semua `screen:` template + `nisn-release-notice.ts`; setiap tujuan dicek `sectionAllowed` per peran. `notif` dibuang dari URL hidup (parameter lain tetap). |
| 7 | Expo & web per potongan dikirim paralel (`Promise.all`), batas waktu KERAS 8 dtk per kiriman (opsi `timeout` web-push hanya batas diam soket), invarian lease dihitung ulang (komentar transport). p256dh divalidasi sebagai titik P-256 saat PUT. Galat tanpa kode HTTP & bukan galat jaringan → `fail WEB_PUSH_REJECTED` (tidak diulang 4x). `lastUsedAt` satu `updateMany` per putaran. |
| 8 | `(await import("web-push")).default` + test pemuat bawaan (`sendNotification`, `getVapidHeaders`). |
| 9 | Keputusan kunci di `scripts/deploy/vapid-keys-rules.ts` (murni + test): 0 = ada, 3 = buat (dua baris), 2 = sebagian/rusak → deploy berhenti. `env.ts`: "" = tidak diisi, berdua atau tidak sama sekali, kunci harus sah. |
| 10 | Test unit memastikan tiga operasi ada di katalog web; jembatan & lembar di `.tsx` (keputusan murni di `web-push-rules.ts`, ber-test); `WebPushBridge`/`WebPushPrompt` dipasang sebagai komponen. |
| 11 | Tunda 7 hari di `localStorage` (murni + test); "diblokir" tidak pernah otomatis; lembar hanya di beranda & tanpa dialog terbuka & laci tertutup; kata "HP" vs "perangkat ini" per jenis perangkat; manifest tanpa `orientation`. |
| 12 | `webPushTtlSeconds(createdAt, now, expiresAt?)`; `loadReachableDevices(userIds, now)` (bendera web dari transport aktif) untuk dispatcher & N5. |

Catatan implementasi: hanya sesi hidup yang pernah dikirimi (loader join `session: {revokedAt: null, expiresAt > now}`),
jadi baris yang lolos penghapusan (mis. dibersihkan kaskade maintenance) tidak pernah menerima push. Bila Web Push
mati (tanpa kunci), dispatcher mengabaikan langganan web dan kartu/lembar disembunyikan. Jawaban default §10 dipakai
(isi lengkap di layar kunci, tanpa ajakan otomatis di desktop, sponsor ikut menerima). Pertanyaan pemilik tambahan:
4. **Beban tinjauan NEW_DEVICE setelah memasang PWA di iPhone.** *Default:* terima (backlog mencatat opsi B1 mengabaikan
   baris yang flag-nya hanya NEW_DEVICE pasca-pasang).


Order: after N1, N2 and N4, before N5 (N5 reuses `loadDevices`). Migration `20261003050000_web_push_subscription`.

## 1. Goal and non-goals

**Goal.** Make push actually reach phones. Today push only targets Expo tokens (`prisma/schema/auth.prisma:98-99`), `PUSH_TRANSPORT` defaults to `log` (`src/lib/env.ts:32`), and no app exists. The work:
- Make studenthub.id an installable PWA (manifest + `/sw.js`).
- Store one VAPID Web Push subscription (`web-push@3.6.7`, `@types/web-push@3.6.4`) per WEB session.
- Let the existing outbox dispatcher deliver to Expo and Web devices side by side, for **all roles**.
- Ask for permission on phones and installed apps. The prompt can be put off, shows device help when blocked, and tells iPhone Safari users to "Tambah ke Layar Utama" first.
- Have deploy generate the VAPID keys.

**Non-goals.**
- No offline cache and no `fetch` handler in the service worker (never cache authenticated responses; HRIS `lib/sw/worker.js:107-155`).
- No receipts, no notification actions.
- No per-category opt-out (N2 handles that at write time).
- No Expo changes and no desktop auto-prompt.
- No item-level routes, because the hub only routes `/hub/<section>` (`src/app/hub/[[...section]]/page.tsx:7`).
- **No nginx change.** Verified 2026-10-03: `https://studenthub.id/sw.js`, `/zzz.png` and `/manifest.webmanifest` all reach Next (`x-nextjs-*` headers). `location /` proxies them (`docs/deploy/nginx-studenthub.conf:60-62`).

## 2. Existing code to reuse or change

| Path:line | Change |
|---|---|
| `src/lib/notifications/rules.ts:40-43` `initialPushStatus` | **PENDING for every role.** The dispatcher marks SKIPPED `NO_DEVICE` when there is no device. Keep the signature (N2 filters before it). Fix the comment at `notify.ts:8`. |
| `src/lib/push/delivery.ts:9-32` | `Device` becomes a union (§5). New signature `loadDevices(userIds, now, opts: { web: boolean })`; it adds subscriptions of live sessions. |
| `delivery.ts:46-70` | Per chunk of 100, split by kind: Expo goes through `sendChunk`, web through `WebPushTransport.send`. Merge results **by index**, so the prefix semantics of `unsentNotificationIds` (`rules.ts:80-83`) still hold. |
| `delivery.ts:72-81` | Web `unregistered` → `webPushSubscription.deleteMany({ where: { id, endpointHash } })`. Each web `ok` → `updateMany lastUsedAt = now`. `tokensCleared` also counts these deletes. |
| `src/lib/push/dispatch.ts:59-76` | New third parameter `webTransport: WebPushTransport \| null = getWebPushTransport()`. Existing callers and tests stay valid. `processClaim` loads unread counts once per batch (`groupBy` on `[userId, readAt]`) for users who have web devices. |
| `src/lib/push/transport.ts:7-19` | `getWebPushTransport()` returns `null` when off, `memoryWebPushTransport` when `PUSH_TRANSPORT=memory`, otherwise the VAPID transport. |
| `src/lib/env.ts:11-51` | Add optional `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`. superRefine requires both keys or neither. |
| `src/lib/auth/sessions.ts:9-41`; `session-service.ts:64-78`; `students/nisn-claim.ts:85-88` | Every revoke deletes the matching subscriptions in the same transaction: `{ sessionId }`, `{ userId, sessionId: { not: except } }`, `{ user: { schoolId } }`, `{ sessionId: { in: ids } }`, `{ session: { deviceId, userId: { not } } }`, `{ userId: { in: holders } }`. |
| `src/lib/tx.ts:14,107-110` | Document the lock order `Web Push: AuthSession (FOR UPDATE) -> WebPushSubscription`. Add `"AuthSession"` to `LOCKABLE_TABLES`. |
| `src/lib/http/rate-limits.ts:19-33` | `WEB_PUSH: { limit: 20, windowMs: 10 * MINUTE_MS }`, keyed by user. |
| `src/lib/auth/policy/notifications.ts` | `"notification.push": { roles: ALL_ROLES, studentStatuses: ALL_STUDENT_STATUSES, sponsorStatuses: ALL_SPONSOR_STATUSES }`. Not allowed while a password change is forced. |
| `src/lib/openapi/registry.ts:22-41` | Add `...webPushContracts`. Then run `pnpm openapi:export && pnpm frontend:sync`: the `/api/web` proxy only forwards operations listed in the catalog (`src/app/api/web/[...path]/route.ts:21-23,106`). |
| `src/app/layout.tsx:27` | `appleWebApp: { title: "studenthub.id", capable: true, statusBarStyle: "default" }`. The manifest link is added automatically from `src/app/manifest.ts`. |
| `next.config.ts:3-9` | Add `headers()` for `/sw.js` (§6). Add `"web-push"` to `serverExternalPackages`. |
| `scripts/brand-assets.mjs:1-10` | Also produce `public/brand/app-192.png`, `app-512.png`, `app-maskable-512.png` (mark at 70 % on white) and `badge-96.png` (white alpha silhouette). Commit the outputs. |
| `src/components/hub/use-session.ts:163` | After the logout call: `void forgetWebPush()`, not awaited. |
| `src/components/hub/hub.tsx:105-117` | Mount `<WebPushPrompt />` and `useWebPushBridge()` inside the provider. |
| `src/components/hub/security-panel.tsx:23` | Add `<WebPushCard />` for all non-restricted roles, following the pattern at `:91-106`. |
| `src/lib/frontend/demo.ts:58` | Make this the first line of `sharedRows`: `if (path === "/me/web-push") return { enabled: true, publicKey: null, subscribed: false };` |
| `scripts/deploy/remote-deploy.sh:187` | After `pnpm install`: `run_step "kunci VAPID" ensure_vapid_keys` (§9.13). |
| `tests/integration/setup.ts:9`; `.github/workflows/ci-cd.yml:45-62` | `env.VAPID_PUBLIC_KEY ??=` / `env.VAPID_PRIVATE_KEY ??=` a fixed test-only pair (comment "khusus test, bukan rahasia"). Put the same pair in the CI env. |

## 3. Data model

In `prisma/schema/auth.prisma`, add `webPushSubscriptions WebPushSubscription[]` to `User` (after `:79`) and `webPushSubscription WebPushSubscription?` to `AuthSession` (after `:109`).

```prisma
/// Langganan Web Push (PWA) satu browser untuk satu sesi WEB (N3, keputusan pemilik 2026-10-03). Endpoint unik
/// (hash SHA-256): ganti akun di browser yang sama memindahkan baris ke sesi baru. Dihapus saat sesinya dicabut
/// atau push service menjawab 404/410; ikut terhapus kaskade saat sesi dibersihkan maintenance.
model WebPushSubscription {
  id           String   @id @default(cuid())
  userId       String
  sessionId    String   @unique
  endpointHash String   @unique @db.Char(64)
  /// URL push service — setara token: tidak pernah dilog utuh atau dikembalikan API.
  endpoint     String   @db.VarChar(2048)
  p256dh       String   @db.VarChar(128)
  auth         String   @db.VarChar(64)
  userAgent    String?  @db.VarChar(255)
  /// Terakhir didaftarkan ulang atau berhasil dikirimi push.
  lastUsedAt   DateTime @default(now())

  user    User        @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Restrict)
  session AuthSession @relation(fields: [sessionId], references: [id], onDelete: Cascade, onUpdate: Restrict)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
}
```

`prisma/migrations/20261003050000_web_push_subscription/migration.sql`:

```sql
-- Langganan Web Push (PWA) per sesi web — keputusan pemilik 2026-10-03 (N3). Aditif saja: satu tabel baru,
-- FK ke User & AuthSession ON DELETE CASCADE (sesi yang dibersihkan maintenance ikut menghapus langganannya).
-- Tidak menyentuh tabel maupun enum lama.

-- CreateTable
CREATE TABLE `WebPushSubscription` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `endpointHash` CHAR(64) NOT NULL,
    `endpoint` VARCHAR(2048) NOT NULL,
    `p256dh` VARCHAR(128) NOT NULL,
    `auth` VARCHAR(64) NOT NULL,
    `userAgent` VARCHAR(255) NULL,
    `lastUsedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WebPushSubscription_sessionId_key`(`sessionId`),
    UNIQUE INDEX `WebPushSubscription_endpointHash_key`(`endpointHash`),
    INDEX `WebPushSubscription_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WebPushSubscription` ADD CONSTRAINT `WebPushSubscription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE `WebPushSubscription` ADD CONSTRAINT `WebPushSubscription_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `AuthSession`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;
```

## 4. Pure rules (tests first)

**`src/lib/push/web/vapid-keys.ts`** (+ test), using `node:crypto`:
- `isVapidPublicKey(v)`: base64url, decodes to 65 bytes, first byte `0x04`.
- `isVapidPrivateKey(v)`: decodes to 32 bytes.
- `generateVapidKeys()`: `generateKeyPairSync("ec", { namedCurve: "prime256v1" })` → JWK. Public = base64url(`0x04‖x‖y`), private = `d`.

**`src/lib/push/web/rules.ts`** (+ test):
```ts
export type WebPushSettings = { mode: "off"; reason: "NO_KEYS" | "BAD_SUBJECT" } | { mode: "memory" | "vapid"; publicKey: string; privateKey: string; subject: string };
export function webPushSettingsOf(env: Pick<Env, "PUSH_TRANSPORT" | "VAPID_PUBLIC_KEY" | "VAPID_PRIVATE_KEY" | "VAPID_SUBJECT" | "APP_ORIGIN">): WebPushSettings;
export function checkPushEndpoint(endpoint: string): boolean;
export function endpointHashOf(endpoint: string): string;
export function webPathOf(role: UserRole, screen: string, notificationId: string): string;
export function webPushTtlSeconds(createdAt: Date, now: Date): number;
export function buildWebPushPayload(row: PushSource & { createdAt: Date }, role: UserRole, unread: number | null): WebPushPayload;
export function classifyWebPushError(error: unknown): Exclude<DeviceResult, { kind: "ok" }>;
```
- **Settings.** Subject = `VAPID_SUBJECT ?? APP_ORIGIN`. It must be `mailto:` or `https://` and not localhost (Safari rejects with `BadJwtToken`); otherwise off with `BAD_SUBJECT`. No keys → off. `PUSH_TRANSPORT=memory` → `memory`.
- **Endpoint (SSRF guard; HRIS accepted any https URL).** `https:` only. No userinfo, no port, no IP literal. Length ≤ 2048. Host must be one of `fcm.googleapis.com`, `*.push.apple.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`.
- **`webPathOf`.** Returns `/hub/<section>?notif=<id>`. Unmapped screens → `/hub/notifications?notif=<id>`.
  - STUDENT: invoice/invoices → my-billing, leave-request → my-leave, report-card → my-reports, attendance → my-attendance, check-in (N5) → `/hub/my-attendance?absen=1&notif=…`.
  - SCHOOL_ADMIN: payment-review/invoice/invoices → billing, leave-review/attendance → attendance, student → students, school-settings → school-settings.
  - SUPER_ADMIN: sponsor → sponsors, ad-review → ad-review, topup-review → topups, school/school-settings → schools.
  - SPONSOR: ad → campaigns, topup/sponsor → balance.
- **TTL** = clamp(3600 − age in seconds, 60, 3600).
- **Payload** = `{ notificationId, title ≤100, body ≤178 (previewText), url, tag: "n-"+id, badge: unread, icon: "/brand/app-192.png", badgeIcon: "/brand/badge-96.png" }`.
- **Classify.** 404/410 → `unregistered`. Anything else → `classifyRequestError` (`src/lib/push/rules.ts:85-93`).

Tests:
- Every settings branch, including the `https://localhost` case.
- Endpoints: the four hosts accepted; `http:`, `10.0.0.1`, `evil.com/fcm.googleapis.com`, `fcm.googleapis.com.evil.com`, userinfo, port and 2049 characters rejected.
- Hash is 64 hex characters and deterministic.
- The full `webPathOf` table, plus fallback and encoding.
- TTL at 0 / 59 / 61 minutes.
- Payload truncation and emoji safety.
- Classification of 404/410/429/503/400/403/413 and `TypeError`.
- Generated keys pass both validators. An ECDSA signature made with `d` verifies against the public key.
- Update `notifications/rules.test.ts:12-13`: all roles → `PENDING`.

**`src/lib/frontend/web-push-rules.ts`** (+ test):
```ts
export interface DeviceInfo { ios: boolean; iosVersion: number | null; android: boolean; mobile: boolean; standalone: boolean }
export function deviceInfoOf(ua: string, env: { maxTouchPoints: number; standalone: boolean; coarse: boolean; width: number }): DeviceInfo;
export type PromptMode = "ask" | "blocked" | "install-ios";
export function promptModeOf(i: { enabled: boolean; demo: boolean; restricted: boolean; deferred: boolean; supported: boolean; permission: NotificationPermission | "unsupported"; device: DeviceInfo }): PromptMode | null;
export function blockedHelpSteps(d: DeviceInfo): string[];
export function promptText(role: Role): string;
export function base64UrlToBytes(key: string): Uint8Array;
export function sameServerKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean;
```
- `deviceInfoOf`: iPadOS (Macintosh UA plus touch) counts as iOS.
- `promptModeOf` returns the first match:
  1. demo, restricted, disabled or deferred → `null`.
  2. Neither mobile nor standalone → `null`.
  3. Unsupported → `install-ios` when iOS ≥ 16.4 and not standalone, otherwise `null`.
  4. Granted → `null` (silent sync).
  5. Denied → `blocked`.
  6. Otherwise → `ask`.

## 5. API

- Contracts: `src/lib/push/web/contracts.ts`, tag `"Notifikasi"`, action `notification.push`.
- Schemas: `web/schemas.ts`. Service: `web/service.ts`.
- Routes: `src/app/api/v1/me/web-push/route.ts` and `.../web-push/subscription/route.ts`.

| Endpoint | Contract | Request → response | Errors |
|---|---|---|---|
| GET `/api/v1/me/web-push` | `getMyWebPushStatus` | → `WebPushStatus { enabled, publicKey: string \| null, subscribed }` | 401, 403 |
| PUT `/api/v1/me/web-push/subscription` | `upsertMyWebPushSubscription` | `z.strictObject({ endpoint: z.url().max(2048), expirationTime: z.number().nullable().optional(), keys: z.strictObject({ p256dh: b64url 80–100, auth: b64url 16–32 }) })` (the `PushSubscription.toJSON()` shape) → `{ subscribed: true }` | 400 `VALIDATION_FAILED`; 422 `WEB_PUSH_DISABLED` "Notifikasi HP belum aktif di server ini."; 422 `WEB_PUSH_APP_SESSION` "Langganan notifikasi browser hanya untuk sesi web."; 422 `WEB_PUSH_ENDPOINT_INVALID` "Alamat langganan notifikasi tidak dikenali."; 401 `SESSION_INVALID`; 429 (limiter `WEB_PUSH`, key user) |
| DELETE same path | `removeMyWebPushSubscription` | → `{ subscribed: false }` (idempotent) | 401, 403 |

**Upsert flow:**
1. `requirePrincipal`. The session must be WEB, settings must not be `off`, and `checkPushEndpoint` must pass. Compute `hash`.
2. In `retryOnUniqueConflict(() => withTx(...))`:
   - `lockRows(tx, "AuthSession", [sid])`, then re-read the session with `{ id: sid, userId, revokedAt: null, expiresAt: { gt: now } }`. If it is gone → 401 `SESSION_INVALID`. This closes the race with a concurrent logout.
   - `deleteMany({ sessionId: sid, endpointHash: { not: hash } })`.
   - `upsert({ where: { endpointHash: hash }, create, update: { userId, sessionId, endpoint, p256dh, auth, userAgent, lastUsedAt: now } })`. The update branch is the account switch.
3. Log `webpush.subscribed { userId, host }`. The endpoint itself is never logged.

No AuditLog and no notification, the same as `registerPushToken` (`session-service.ts:162-175`). The data is not per-school, so SchoolScope does not apply. Rows are always keyed by the caller's own `sid`/`userId`.

**Delete:** `withTx(deleteMany({ sessionId: sid }))`.
**Status:** `enabled = mode !== "off"`, `subscribed = exists({ sessionId: sid })`.

**Dispatcher types:**
```ts
type Device = { kind: "expo"; sessionId: string; token: string }
            | { kind: "web"; subscriptionId: string; endpointHash: string; target: WebPushTarget; role: UserRole };
interface WebPushTransport { readonly name: "vapid" | "memory"; send(items: readonly WebPushSend[]): Promise<readonly DeviceResult[]> } // tidak pernah melempar
```
- **Web loader:** `webPushSubscription.findMany({ where: { userId: { in }, session: { revokedAt: null, expiresAt: { gt: now } } }, select: { …, user: { select: { role: true } } } })`.
- **`transports/webpush.ts`:**
  - Lazy `import("web-push")` with an injectable sender.
  - At most 20 sends at once (`WEB_PUSH_CONCURRENCY = 20`).
  - Options: `{ TTL, urgency: "high", timeout: 5_000, contentEncoding: "aes128gcm", vapidDetails }`.
  - On 401/403, log `push.webpush_credentials { host }`.
- **Lease invariant (put it in a comment):** ⌈100/20⌉×5 s = 25 s per chunk, so the 40 s budget plus 25 s plus the Expo timeouts stays under the 120 s lease (`constants.ts:20-22`).
- **`transports/web-memory.ts`:** records sends, `setStatusScript`, `reset`.

## 6. UI

**Manifest** (`src/app/manifest.ts`):
- `id` and `start_url` `/hub`, `scope` `/`, `display` `standalone`, `orientation` `portrait`.
- `name` and `short_name` "studenthub.id", `lang` `id`.
- `theme_color` `#1e3a8a` (`DEFAULT_THEME.bannerColor`), `background_color` `#ffffff`.
- Icons: 192 and 512 `any`, 512 `maskable`.
- When the logo changes, **rename** the icon files: Chrome only refreshes an installed icon when its URL changes (HRIS `app/manifest.webmanifest/route.ts:3-8`).

**Service worker** (`public/sw.js`, plain ES2017):
- `install` → `skipWaiting()`. `activate` → `clients.claim()`.
- `push`: **always** call `showNotification(title, { body, icon, badge: badgeIcon, tag, data: { url } })`, because iOS revokes subscriptions that receive silent pushes.
  - If the payload can't be parsed, show the fallback: "studenthub.id" / "Ada kabar baru. Ketuk untuk membuka." / `/hub/notifications`.
  - Also call `setAppBadge(badge)` (`clearAppBadge` at 0; skip when null) and `postMessage({ type: "studenthub:push" })` to window clients.
- `notificationclick`:
  - Resolve the url against `origin`. If it is cross-origin or outside `/hub`, use `/hub`.
  - If a window client exists, prefer one on `/hub`: `focus()`, then `postMessage({ type: "studenthub:navigate", url })`. Do not use `navigate()`, which needs SW control and reloads the page.
  - Otherwise `openWindow(url)`.
- `pushsubscriptionchange`:
  - Get the key from `oldSubscription.options.applicationServerKey`, or else from `GET /api/web/me/web-push`.
  - Subscribe, then `PUT /api/web/me/web-push/subscription`. On 401: `POST /api/web/auth/refresh` and retry once.
  - Swallow all errors.
- No `fetch` listener.
- `next.config.ts` headers for `/sw.js`: `Content-Type: application/javascript; charset=utf-8`, `Cache-Control: no-cache, no-store, must-revalidate`, `Content-Security-Policy: default-src 'self'; script-src 'self'`, `X-Content-Type-Options: nosniff`.
- Register with `register("/sw.js", { scope: "/", updateViaCache: "none" })`, only when push is enabled and not in demo mode.

**Client** (`src/lib/frontend/web-push-client.ts`; nothing here ever throws):
- `isPushSupported()`.
- `loadWebPushStatus(demo)`: in demo mode returns `demoRows("/me/web-push")` without a network call.
- `requestPermission()`: also handles the old Safari callback form.
- `ensureSubscribed(status, userId)`:
  - Registers the SW.
  - Resubscribes when `!sameServerKey`.
  - Sends the PUT.
  - Marks `sessionStorage studenthub_push_sync=<userId>`, so this runs once per tab.
- `disableWebPush()`: DELETE, then `unsubscribe()`.
- `forgetWebPush()`: `unsubscribe()` and clear the mark. Called on logout; the server row is already gone through the revoke.

**`useWebPushBridge()`** (`src/components/hub/web-push-bridge.ts`):
- `studenthub:navigate` → `router.push(url)`, but only for `/hub` URLs. Revision after the deploy review (2026-10-03): a target on the SAME pathname is loaded in full (`navigationKind`), because `?notif=` and intents such as `?absen=1` are only read on mount; the service worker only posts to `/hub` windows and otherwise opens a new window.
- `studenthub:push` → `unreadBadge.refresh()` (N1).
- `?notif=<cuid>` when not in demo:
  - `POST /notifications/{id}/read`.
  - `router.replace` without the parameter.
  - `unreadBadge.refresh()`.
- If permission is granted and this tab has not synced yet → `ensureSubscribed`.

**`WebPushPrompt`** (`src/components/hub/web-push-prompt.tsx`): bottom-sheet `role="dialog"`, focus on the primary button. "Nanti saja" → `sessionStorage studenthub_push_later=1`.

| Mode | Title | Text | Buttons |
|---|---|---|---|
| ask | Aktifkan notifikasi | `promptText(role)`, ending "…langsung muncul di HP-mu walau aplikasi tertutup." Siswa: "Kabar absen, tagihan, dan pengumuman". Admin sekolah: "Pengajuan izin, bukti bayar, dan kabar sekolah". Sponsor: "Status iklan dan saldo". Super admin: "Moderasi iklan, top-up, dan kabar platform". | **Aktifkan** · Nanti saja |
| blocked | Notifikasi diblokir | "Browser tidak akan bertanya lagi. Izinkan lewat pengaturan:" + `blockedHelpSteps` (adapted from HRIS `IzinNotifikasiPopup.tsx:52-82`) | **Saya sudah mengizinkan** · Nanti saja |
| install-ios | Tambahkan ke Layar Utama dulu | "Di iPhone, notifikasi hanya aktif bila studenthub.id dibuka dari ikon di layar utama." 1 "Ketuk tombol Bagikan (kotak dengan panah ke atas)." 2 "Pilih Tambah ke Layar Utama, lalu Tambah." 3 "Buka dari ikon baru, masuk sekali lagi, lalu aktifkan notifikasi." | **Mengerti** |

Feedback messages:
- Success: "Notifikasi aktif. Kabar baru muncul di HP ini."
- Subscribe failed (also defers the prompt): "HP ini belum bisa menerima notifikasi. Coba lagi nanti."
- Permission dialog dismissed: "Izin belum dipilih. Ketuk Aktifkan sekali lagi."
- Still blocked: "Masih diblokir. Ikuti langkah di atas, lalu coba lagi."

**`WebPushCard`** ("Notifikasi di perangkat ini"; hidden when push is disabled):

| State | Text | Action |
|---|---|---|
| Active | "Aktif di perangkat ini." | **Matikan** → "Notifikasi dimatikan di perangkat ini." |
| Inactive | "Belum aktif." | **Aktifkan** |
| Denied | "Diblokir di browser ini." + steps | **Periksa lagi** |
| iOS tab | Install steps | none |
| Unsupported | "Browser ini belum mendukung notifikasi." | none |

In demo mode the buttons show `DEMO_MESSAGE` (`security-panel.tsx:15`).

## 7. Tests

**Unit:**
- §4 suites.
- `env.test.ts`: both-or-none rule, bad key.
- `transports/webpush.test.ts` (fake sender): options, max 20 in flight, results stay aligned, 410 → `unregistered`, a rejection never throws, only the host is logged.
- `src/lib/push/sw.test.ts` (`node:vm` running `public/sw.js` with a fake `self`):
  - Push → notification. Malformed payload → fallback notification. Badge set and clear.
  - Click: existing client → focus + message; no client → `openWindow`; cross-origin url → `/hub`.
  - `pushsubscriptionchange` → PUT; 401 → refresh → PUT.
- `demo.test.ts`: `/me/web-push`.
- `scripts/deploy/vapid-keys.test.ts`: output has exactly two lines, and `web-push` `getVapidHeaders` accepts the keys.

**Integration** (`tests/integration/push/`):
- `web-subscriptions.test.ts`:
  - Status before and after PUT.
  - Idempotent PUT: one row, `lastUsedAt` advances.
  - New endpoint on the same session replaces the old row.
  - Account switch moves the row to the new user.
  - Errors: ANDROID session → 422; bad host/http/IP → 422; bad keys → 400; 401; 403 `PASSWORD_CHANGE_REQUIRED`; double DELETE is fine; 21st PUT → 429.
  - Rows are deleted by: logout, logout-all, `DELETE /me/sessions/{id}`, password change (other sessions only), school deactivation, a replacing student mobile login.
  - Race: `Promise.all` of revoke and PUT leaves no row on the revoked session.
- `web-dispatch.test.ts` (`memoryWebPushTransport`):
  - SCHOOL_ADMIN `payment-review` → SENT. url `/hub/billing?notif=<id>`, badge = unread count, TTL within range.
  - Student with Expo and Web devices → both sent.
  - 410 on the only device → row deleted, FAILED `DeviceNotRegistered`. 410 on one device and ok on another → SENT.
  - 503 → PENDING with backoff. 403 → FAILED `HTTP_403`, row kept.
  - Revoked or expired session → `NO_DEVICE`.
  - `webTransport=null` → web ignored.
  - `lastUsedAt` updated after a successful send.
- Update tests that assumed staff were SKIPPED; they must accept PENDING or SKIPPED `NO_DEVICE`: `platform/tx-notify.test.ts:43-78`, `attendance/leave/student.test.ts:94`, `billing/submissions.test.ts:66`.

**E2E** (`e2e/pwa.spec.ts`, request-only):
- Manifest: 200, name, `start_url`, three icons, each icon 200 `image/png`.
- `/sw.js`: 200, JavaScript content type, `no-cache`.
- `/hub` contains `rel="manifest"`.
- Admin login → `enabled:true` → PUT an FCM-shaped endpoint → `subscribed:true` → logout → login → `subscribed:false`.

## 8. Docs

- **`docs/PLAN.md`:**
  - `:21`: add a row "Web (PWA) | manifest + `/sw.js`, Web Push VAPID ke semua peran (keputusan 2026-10-03)".
  - `:98`: mention `WebPushSubscription`.
  - `:141`: add the `/me/web-push*` endpoints.
  - `:229-231`: push now goes to all roles through the same outbox (Web Push + Expo); 404/410 deletes the subscription; iPhone needs iOS 16.4+ and "Tambah ke Layar Utama"; unread-count polling stays (N1).
  - `:330`: real push now goes through Web Push, with keys generated at deploy. Expo/EAS is only for a native app.
- **`docs/design/05-platform-crosscutting.md` D5 (`:19`) and N2 (`:206`):** add a note "diganti PLAN 2026-10-03 (N3)".
- **`docs/backlog.md:16`:** Web Push needs no receipts (the HTTP status is synchronous). New row: "Pengingat ulang izin notifikasi / prompt setelah absen pertama". Trigger: low opt-in.
- **`docs/FRONTEND.md`:**
  - New section "Notifikasi HP (PWA)": when the prompt shows, its modes, the Keamanan card, click → section + `?notif`, demo behaviour, iPhone, icon renaming.
  - `:21` "Semua": add "notifikasi HP".
- **`docs/deploy/BOOTSTRAP.md` and `.env.example`:** `VAPID_*` is generated by deploy. **Never rotate** it (every subscription breaks), and back up `.env`.

## 9. Edge cases, risks and HRIS lessons

1. **iOS revokes subscriptions after silent pushes.** The SW always shows a notification (HRIS `worker.js:42-46`).
2. **iOS home-screen apps have separate storage.**
   - The user logs in again, which creates a new web `deviceId` (`login.tsx:43`).
   - The Safari session is REPLACED, and a one-time `NEW_DEVICE` flag appears for ≤7 days (`anomaly-rules.test.ts:89`).
   - This is expected: the install copy says "masuk sekali lagi", and B1 treats the flag as informational.
3. **Key rotation and partial keys.** Deploy never regenerates keys and stops if only one is present. The client resubscribes when the server key changes (HRIS `pushClient.ts:88-91`).
4. **SSRF.** Host allowlist. The endpoint is never logged or returned.
5. **Sending from the wrong environment** (HRIS 58189be). Keys are separate per environment `.env`; dev has none, so push is off there. A database from another environment gets 403 → FAILED, and nothing is sent.
6. **At-least-once duplicates.** `tag` collapses them.
7. **Late pushes.** TTL ≤ the remaining part of the 60-minute window, consistent with `EXPIRED`.
8. **Subscribe vs revoke race.** The `AuthSession` row lock handles it. The loader only joins live sessions, and maintenance cascades clean up leftovers (`maintenance.ts:123`).
9. **Web session ends (30 days).** Push stops until the next login, which re-syncs silently.
10. **Lock screen.** It shows the same text as the inbox preview.
11. **Unsupported devices** (no Google services, iOS < 16.4). Excluded silently.
12. **Wrong-role link.** Falls back to `/hub/notifications`, and `useSectionGuard` (`hub.tsx:50-54`) still applies.
13. **Deploy step** (runs as user `studenthub`, no openssl):
```bash
ensure_vapid_keys() {
  local pub priv; pub="$(grep -cE '^VAPID_PUBLIC_KEY=' .env || true)"; priv="$(grep -cE '^VAPID_PRIVATE_KEY=' .env || true)"
  if grep -qE '^VAPID_PUBLIC_KEY=.+' .env && grep -qE '^VAPID_PRIVATE_KEY=.+' .env; then sh_log "kunci VAPID sudah ada"; return 0; fi
  [ "$pub" = 0 ] && [ "$priv" = 0 ] || sh_die ".env memuat kunci VAPID tidak lengkap — perbaiki manual (jangan dibuat ulang: semua langganan push putus)"
  local keys; keys="$(pnpm exec tsx scripts/deploy/vapid-keys.ts)" || sh_die "gagal membuat kunci VAPID"
  printf '\n# Kunci VAPID Web Push (remote-deploy.sh %s). JANGAN diganti: semua langganan push akan putus.\n%s\n' "$(date -u +%F)" "$keys" >> .env
  sh_log ".env: kunci VAPID ditambahkan (nilai tidak ditampilkan)"
}
```
   - `scripts/deploy/vapid-keys.ts` (relative imports) prints only the two `KEY=value` lines.
   - The keys are read at runtime through `getEnv`, so no rebuild is needed; `pm2 startOrReload --update-env` picks them up.
14. **Coordination:**
   - N1: badge refreshes go through `unreadBadge`, and the SW sets the badge itself while the app is closed.
   - N2: filters at write time.
   - N5: calls `loadDevices(…, { web: true })` and uses the screen `check-in`.

## 10. Open questions

1. **Lock-screen content.** Full title and body, or a generic "Ada kabar baru di studenthub.id"? Default: full, the same as the inbox.
2. **Desktop auto-prompt for admins and sponsors.** Default: no. They can enable it from Keamanan akun.
3. **Push for sponsors.** Default: yes.
