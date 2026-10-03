# N1: Notification badge kept current by polling

## 0. Revisi setelah kritik (2026-10-03) — berlaku di atas draf di bawah

Sumber: `N1-badge-polling.critique.md`. Semua temuan diterima; yang mengubah desain:

| # Kritik | Keputusan (sudah diimplementasikan) |
|---|---|
| 1 | `BadgePollState` menyimpan `nextDueAt` (dipertahankan saat tersembunyi; hanya timer OS yang dihapus) dan `notBefore` (Retry-After). `decideFetch` mengembalikan `fetch` / `queue` / `idle` / `wait{delayMs}` — kembali terlihat < 5 dtk setelah percobaan **menunggu jadwal**, tidak pernah "lewati" tanpa timer. Jeda 5 dtk hanya setelah percobaan berhasil; `online` setelah gagal langsung mengambil. Test: sembunyi-tampil cepat & hasil tiba saat tersembunyi tetap berlanjut. |
| 2 | `apiFetch`: refresh 409 → tunggu `REFRESH_RACE_WAIT_MS` (300 ms) lalu ulangi; masih 401 → refresh sekali lagi; baru setelah itu `studenthub:expired` (aturan murni `afterRefresh`). Proxy tidak menghapus penanda sesi pada 409 (perubahan server kecil yang disengaja). Poller: 401 = coba lagi, hanya 403 = berhenti. |
| 3 | `stop()`: `generation++`, batalkan, hapus timer & listener, reset seluruh keadaan (termasuk antrean & kegagalan). `apiFetch` memeriksa `signal.aborted` setelah menunggu refresh (tanpa event "Sesi berakhir"). AbortError dipetakan ke status -1 dan dibuang lewat generation. |
| 4 | Retry-After dibaca dari body (`error.details.retryAfterSeconds`, `retryAfterFromBody`) dan disimpan sebagai `notBefore`; focus/visible/mutasi tidak menembusnya. |
| 5 | Jitter diterapkan SETELAH batas 5 menit (270–330 dtk). |
| 6 | Tanpa `navigator.setAppBadge` (keputusan integrasi 5): badge ikon milik service worker N3. |
| 7 | Polling memakai `apiFetch(..., { background: true })`: sesi yang berakhir di latar **tidak** menendang pengguna dari formulir; aksi berikutnya yang menangani (perilaku hari ini tetap). |
| 8 | Biaya dicatat: tab terlihat memutar token tiap 15 menit (1.000 siswa terlihat ≈ 1,1 transaksi refresh/detik); log `request` 2xx untuk unread-count tidak ditulis (`quietSuccessLog` di kontrak) agar log rotasi 20 MB × 14 tidak tergeser. |
| 9 | Poller disimpan di `globalThis` (HMR dev tidak menggandakan). StrictMode: fetch pertama dibatalkan & dibuang lewat generation — tidak berbahaya. |
| 10 | Test integrasi baru dikurangi menjadi satu asersi di test read-all yang ada (notifikasi baru setelah read-all → total 1). |
| 11 | PLAN hanya satu kalimat keputusan; parameter di FRONTEND.md & D5; deskripsi kontrak unread-count diperbarui (30 dtk staf/sponsor, 60 dtk siswa) + `openapi:export`. |

Jawaban default §10 dipakai: siswa 60 dtk; demo menampilkan angka belum dibaca data contoh tanpa jaringan.


## 1. Goal & non-goals
**Goal.** The bell dot (topbar) and the count badge (sidebar "Notifikasi") keep up with the server while the hub is open. One shared poller per browser tab handles this. It fetches immediately on start, on return to the page (visible/focus/online) and right after "Tandai dibaca"/"Tandai semua dibaca". While the page is visible it fetches every 30 s (students every 60 s). It pauses while the page is hidden and backs off exponentially on errors. It makes no network calls in demo mode and stops at logout or identity change. It publishes the count to `navigator.setAppBadge` when the browser supports it, so N3 (Web Push) reuses the same badge path.

**Non-goals.** No server, schema, contract or OpenAPI change. No SSE/WebSocket (design D5). No cross-tab sharing such as BroadcastChannel or leader election. No toast or sound for new items (that is N3/N4). No auto-reload of the notification list. No per-category counts (N2). No service worker (N3).

## 2. Existing code to reuse/change
| Path:line | Today | Change |
|---|---|---|
| `src/components/hub/hub.tsx:25-40` | `useNavigationData` fetches `/notifications/unread-count` once per user (`:35`) and returns `{unread, schools}` | Remove `unread` from `NavData` and from the fetch, so the hook only returns schools for SUPER_ADMIN. Add `useUnreadBadge` (§6). |
| `hub.tsx:94,107,108` | `unread` passed to `Sidebar`/`Topbar` | Pass the value from `useUnreadBadge(me, demo)` instead |
| `src/components/hub/frame.tsx:24` | `<b className="count-badge">{unread}</b>` | `{badgeLabel(unread)}` ("99+" above 99, per contract text at `contracts.ts:39`) |
| `frame.tsx:52` | aria-label `Notifikasi, ${unread} belum dibaca` | Use `badgeLabel(unread)`. Keep the dot. |
| `src/components/hub/action-dialog.tsx:79` | `onDone(); toast(...)` after a successful mutation | Add `if (affectsUnreadBadge(op.id)) unreadBadge.refresh();`. Demo exits earlier at `:74`. |
| `src/components/hub/use-session.ts:156-160` (logout), `:60` (`leaveEnvironment`) | logout revokes the session, then the identity is cleared after the splash | Call `unreadBadge.stop()` as the **first** statement of both, so no poll runs against a revoked session. |
| `src/lib/frontend/api.ts:12-14` | refresh `!ok` → dispatch `studenthub:expired` | Retry the original request when `retryAfterRefresh(status)` is true (2xx or **409 `REFRESH_RACE`**, `src/lib/auth/refresh-service.ts:101`). Another tab already rotated the cookies. |
| `src/lib/frontend/demo.ts:66` | demo notification rows (3, no `readAt`) | Export `demoUnreadCount(): number` |
| Endpoint (reuse as-is) | `GET /api/v1/notifications/unread-count` (`contracts.ts:33-42`, `route.ts` in `src/app/api/v1/notifications/unread-count/route.ts:6`) | No change |

**Cost of one poll (measured by reading the code):** browser → `/api/web` proxy (`src/app/api/web/[...path]/route.ts:101-145`) → loopback `/api/v1`. Then: JWT verify, one `AuthSession.findUnique` with nested user/school/student/sponsor select (`src/lib/auth/get-auth.ts:28-55`), and one `groupBy(type)` over index `[userId, readAt]` (`src/lib/notifications/queries.ts:55-65`, `prisma/schema/notification.prisma:134`). Each poll also writes one `request` log line (`src/lib/http/route.ts:162-173`). The contract has no `rateLimit`, and `applyRateLimit` returns early (`route.ts:69-70`). We deliberately add none: the endpoint is authenticated and cheap, and a limit would cause false 429s for users with several tabs. The DB pool is `DB_CONNECTION_LIMIT` 10 (`src/lib/db.ts:18`), which is why there is jitter and the student interval is longer (§9).

## 3. Data model
**None.** There is no Prisma change and no migration. (If one were ever needed, its folder would use the prefix `2026100307xxxx`, but N1 needs none.)

## 4. Pure rules: `src/lib/frontend/badge-poll-rules.ts` (+ `badge-poll-rules.test.ts`, written FIRST)
```ts
import type { Role } from "./types";
export const BADGE_POLL_BASE_MS: Readonly<Record<Role, number>> = { SCHOOL_ADMIN: 30_000, SUPER_ADMIN: 30_000, SPONSOR: 30_000, STUDENT: 60_000 };
export const BADGE_BACKOFF_MAX_MS = 300_000;   // 5 menit
export const BADGE_JITTER_RATIO = 0.1;         // ±10 %
export const BADGE_MIN_GAP_MS = 5_000;         // visible/focus/online beruntun = satu permintaan
export const BADGE_LABEL_MAX = 99;
export type BadgeTrigger = "start" | "timer" | "visible" | "focus" | "online" | "mutation";
export interface BadgePollState { readonly failures: number; readonly lastAttemptAt: number | null; readonly inFlight: boolean }
export function decideFetch(s: BadgePollState, t: BadgeTrigger, now: number, visible: boolean): "fetch" | "queue" | "skip";
export function nextDelayMs(i: { role: Role; failures: number; random: number; retryAfterMs?: number }): number;
export function classifyPollFailure(i: { status: number; retryAfterSeconds?: number }): { kind: "retry" | "stop"; retryAfterMs?: number };
export function parseUnreadTotal(envelope: unknown): number | null;
export function badgeLabel(count: number): string;
export function appBadgeAction(count: number, supported: boolean, last: number | null): "set" | "clear" | "none";
export function affectsUnreadBadge(operationId: string): boolean;
```
Rules:
- `decideFetch`: if `inFlight`, return `"queue"` for `mutation` and `"skip"` otherwise. If not visible, return `"fetch"` for `mutation` and `"skip"` otherwise. `start`, `timer` and `mutation` return `"fetch"`. `visible`, `focus` and `online` return `"skip"` when `now - lastAttemptAt < 5 s`, otherwise `"fetch"`.
- `nextDelayMs = max(retryAfterMs ?? 0, min(MAX, round(base × 2^min(failures,10) × (1 − J + 2J·random))))`.
- `classifyPollFailure`: status 401 or 403 → `stop`. Anything else (0 = network, 404, 429, 5xx, 502 from the proxy, or a malformed 200) → `retry`. `retryAfterMs = retryAfterSeconds × 1000` when that value is given.
- `parseUnreadTotal`: returns `data.total` only when `success === true` and `total` is an integer ≥ 0. Otherwise it returns `null`.
- `badgeLabel`: 0 → `""`, 1–99 → the digits, above 99 → `"99+"`.
- `appBadgeAction`: unsupported, or `count === last` → `none`. Count 0 → `clear`. Otherwise `set`.
- `affectsUnreadBadge`: true only for `markNotificationRead` and `markAllNotificationsRead`.

Test cases (`node:test`, Indonesian names):
1. `decideFetch`: start/timer while visible → fetch; timer while hidden → skip; focus 4 999 ms after the last attempt → skip, at 5 000 ms → fetch; `lastAttemptAt` null → fetch; in flight + mutation → queue; in flight + timer/focus → skip; mutation while hidden → fetch.
2. `nextDelayMs`: SCHOOL_ADMIN with random 0.5 → 30 000; STUDENT → 60 000; random 0 → 27 000 and random 1 → 33 000; failures 1/2/3 → 60/120/240 s; failures 4 and 50 → 300 000 (no overflow); retryAfterMs 600 000 → 600 000.
3. `classifyPollFailure`: 401 and 403 → stop; 0, 404, 500, 502 and 503 → retry; 429 with 120 → retry with 120 000.
4. `parseUnreadTotal`: valid → n; total 0 → 0; `success:false`, missing data, `"3"`, -1, 2.5, null or a string → null.
5. `badgeLabel`: 0, 1, 99, 100, 12 345.
6. `appBadgeAction`: every branch, including `last === null` with count 0 → clear.
7. `affectsUnreadBadge`: the two ids → true; `listNotifications` and `getNotification` → false.

## 5. API
No new endpoint and no contract change. The UI keeps calling `GET /api/web/notifications/unread-count` (action `notification.self`, all roles, response `{total, announcements, personal, latestCreatedAt}`). No `withTx`, locks, audit or notifications are involved, because nothing is mutated. `docs/openapi.json` and `catalog.json` stay unchanged, so `openapi:check` is unaffected.

**Controller: `src/lib/frontend/unread-badge.ts`** (+ `unread-badge.test.ts`). It is a class, so every method stays under 50 lines (ESLint `max-lines-per-function` warns at 50, `eslint.config.mjs`).
```ts
export interface BadgeSession { readonly userId: string; readonly role: Role }
export type BadgeSignal = "visible" | "hidden" | "focus" | "online";
export interface BadgeDeps {
  fetchUnread(signal: AbortSignal): Promise<{ status: number; body: unknown }>; // status 0 = galat jaringan
  setTimer(fn: () => void, ms: number): unknown; clearTimer(h: unknown): void;
  now(): number; random(): number; isVisible(): boolean;
  listen(on: (s: BadgeSignal) => void): () => void;
  appBadge: { supported(): boolean; set(n: number): Promise<void>; clear(): Promise<void> };
}
export class UnreadBadgePoller {
  constructor(deps: BadgeDeps);
  start(session: BadgeSession): void;  // sama userId+role & berjalan -> no-op (StrictMode)
  stop(): void;                          // batalkan request, hapus timer & listener, count=0, clear app badge
  refresh(): void;                       // pemicu "mutation"; diabaikan bila berhenti
  readonly subscribe: (l: () => void) => () => void;  // arrow property: referensi stabil
  readonly getSnapshot: () => number;
}
export const unreadBadge: UnreadBadgePoller; // diikat ke browserBadgeDeps(); aman di-import saat SSR
```
Flow:
- `start`: `stop()` → `generation++` → count 0 (notify) → attach listeners → `run("start")`.
- `run(t)`: calls `decideFetch`.
  - fetch: clear the timer, set `inFlight` and `lastAttemptAt`, create a new `AbortController`, and capture `gen`.
  - On the result, drop it if `gen !== generation`.
  - On success: `failures=0`, `setCount`, `schedule`.
  - On failure: `classifyPollFailure`. `stop` → `stop()`. `retry` → `failures+1` and `schedule(nextDelayMs)`.
  - Either way, if a run is queued, run `"mutation"` immediately.
- `schedule(ms)`: does nothing while hidden. That is the pause; the `visible` signal resumes polling.
- `hidden` clears the timer. `visible`, `focus` and `online` call `run`.
- `setCount`: notifies listeners only on change. It syncs the app badge through `appBadgeAction(total, supported, lastAppBadge)` and swallows errors (`.catch(() => {})`; no `console.*`).

`browserBadgeDeps()` lives in the same file:
- `fetchUnread` uses `apiFetch("/notifications/unread-count", { signal })` (`api.ts:7`). It reads `status`, then the JSON body with `.catch(() => null)`. A `TypeError` becomes `{status: 0}`.
- `isVisible` returns `typeof document === "undefined" || document.visibilityState === "visible"`.
- `listen` attaches `visibilitychange` on `document`, and `focus` and `online` on `window`.
- `appBadge` checks `"setAppBadge" in navigator`.

Every DOM access happens inside function bodies, never at import time. A 401 still goes through `apiFetch`'s refresh. If the refresh fails, the existing `studenthub:expired` → `setMe(null)` → the hook stops the poller.

## 6. UI changes
In `hub.tsx`:
```tsx
/** Badge notifikasi: satu poller bersama (unread-badge.ts); demo = angka data contoh, tanpa jaringan. */
function useUnreadBadge(me: Identity | null, demo: boolean): number {
  const live = useSyncExternalStore(unreadBadge.subscribe, unreadBadge.getSnapshot, () => 0);
  const userId = me?.user.id, role = me?.user.role, restricted = me ? isRestricted(me) : true;
  useEffect(() => {
    if (!userId || !role || demo || restricted) { unreadBadge.stop(); return; }
    unreadBadge.start({ userId, role });
    return () => unreadBadge.stop();
  }, [userId, role, demo, restricted]);
  return demo ? demoUnreadCount() : live;
}
```
States:
- No identity, or a restricted identity (must change password / enrol TOTP): poller stopped, badge 0. This matches today's `hub.tsx:31`.
- Live: dot plus count. On error the last known count stays visible and nothing is shown to the user. The badge is passive, which follows the owner rule "feedback short, never verbose".
- Demo: `demoUnreadCount()` (3) is shown, with zero requests and no app badge.
- Account or persona switch: 0 right away, then the new count. Data never leaks between accounts, keeping the guarantee at `hub.tsx:27`.

**No new copy.** The visible labels stay "Notifikasi" and "Notifikasi, {n} belum dibaca", where n comes from `badgeLabel`.

## 7. Tests
**Unit**
- `badge-poll-rules.test.ts` (§4).
- `unread-badge.test.ts` uses fake deps: a manual clock, a timer queue, and a scripted `fetchUnread`. Cases:
  1. start → exactly one fetch; success sets the snapshot and notifies listeners once; the next timer is at 30 s (random 0.5).
  2. timer → fetch; `hidden` clears the timer; advancing 10 min gives 0 fetches; `visible` → immediate fetch; `focus` 1 s later → no fetch.
  3. 503 several times → delays 60, 120, 240, 300, 300 s; then success → back to 30 s.
  4. 429 with `retryAfterSeconds: 600` → timer at 600 s.
  5. 401 → stopped: snapshot 0, listeners detached, no timers left.
  6. `refresh()` while in flight → exactly one extra fetch right after the first one resolves.
  7. `stop()` while in flight → the signal is aborted, a late resolution is ignored, and the snapshot stays 0.
  8. `start(B)` after `start(A)` → snapshot 0 immediately; A's late result is ignored; B's result is shown.
  9. `start` with the same session twice → one fetch.
  10. Malformed 200 → backoff, snapshot unchanged.
  11. App badge: set on change, clear at 0, nothing when unsupported, cleared on `stop()`; a rejected `set` does not throw.
  12. `refresh()` after `stop()` → no fetch.
- `demo.test.ts`: `demoUnreadCount()` equals the number of demo notification rows without `readAt` and is greater than 0.
- New `src/lib/frontend/api.test.ts`: `retryAfterRefresh` returns true for 200 and 409, false for 401, 403 and 500.

**Integration** (`tests/integration/notifications/inbox-read.test.ts`, one new case): "unread-count langsung turun setelah read dan read-all (badge read-your-writes)". The test seeds 3 personal items; count 3 → mark one read → 2 → read-all → 0 → `notify` one new item → 1. This protects the assumption behind the immediate refresh after a mutation.

**Browser (local; `pnpm test:frontend`, not a CI gate)**: new `tests/browser/notification-badge.spec.ts`. It uses `page.clock.install()` and mocks `**/api/web/**` like `frontend.spec.ts:10-16`, counting unread-count calls.
1. Mocked 3 then 5 → after `runFor(31_000)` the sidebar shows 5.
2. `visibilityState` overridden to hidden with a dispatched event → `runFor(300_000)` makes no calls; visible again → 1 call.
3. Notifications page → "Tandai semua dibaca" → mock returns 0 → the badge disappears before 30 s pass.
4. Demo admin → 0 unread-count calls; badge "3".
5. Logout → `runFor(120_000)` makes no calls.
6. Mock 150 → "99+".

**E2E (`e2e/`)**: no change (the API surface is untouched). Coverage: all logic lives in tested `.ts` files. Hooks stay in `.tsx`, which `.c8rc.json` excludes (`"extension": [".ts"]`). Only `browserBadgeDeps()` (~20 lines) is uncovered.

## 8. Docs to update
- **`docs/PLAN.md:231`**: replace "Dashboard web cukup polling unread-count." with: the web updates the badge through one shared poller on unread-count. It polls every 30 s for staff/sponsors and 60 s for students, only while the page is visible, and immediately on return or after "tandai dibaca". It backs off up to 5 minutes on errors and makes no network calls in demo. Web Push follows (N3). The "Ditunda" list is unchanged.
- **`docs/FRONTEND.md`**, new bullet under "Struktur dan pemeliharaan": `src/lib/frontend/unread-badge.ts` plus `badge-poll-rules.ts` (with the behaviour above, "99+", the app badge via `navigator.setAppBadge` when supported, and N3 reusing it). Add one line under "Sesi web": when two tabs refresh at the same time, a 409 `REFRESH_RACE` is retried instead of ending the session.
- **`docs/backlog.md`**, under "Tambahan dari implementasi", new "### Polling badge notifikasi (N1)". It records three deferred items: (a) cross-tab sharing via BroadcastChannel, to do if many admins keep several windows visible; (b) dropping or downgrading the `request` log for unread-count, to do if log volume becomes a problem; (c) an SSE/push channel for staff, to do if 30 s feels too slow after N3.
- **`docs/design/05-platform-crosscutting.md:19` (D5)**: append "(web student hub polls every 60 s; see docs/FRONTEND.md)". PLAN wins if the two conflict.

## 9. Edge cases & risks
| Risk | Handling |
|---|---|
| **Load at the morning check-in peak** (≈1 000 students per school on phones, pool of 10) | Students poll every 60 s, there is ±10 % jitter (no thundering herd after the bell), polling stops while hidden, there is one poller per tab, and a single in-flight request at a time. Worst case: 1 000 visible at once ≈ 17 req/s, each about 2 small indexed queries. Realistic: under 1 req/s. |
| Logout race (a poll hits the revoked session → false "Sesi berakhir") | `stop()` runs first in `logout`/`leaveEnvironment` and aborts the in-flight request. |
| Two visible windows refreshing the token at the same moment → 409 → false logout (made more likely by polling) | `apiFetch` retries on 409 (`retryAfterRefresh`). |
| Account or persona switch | `generation` drops stale results and the count resets to 0. |
| React StrictMode double effects | `start` is idempotent and `stop`/`start` are safe to call repeatedly. |
| Hidden tab or bfcache restore | Paused; `visibilitychange`/`focus` fetch immediately, deduplicated within 5 s. |
| Server down / 502 / network | Backoff from 30 s up to 5 minutes; the last count is kept. `online` triggers a fetch. |
| 401/403 | Stop. The existing session flow takes over; a later restart happens on identity change. |
| Mark-read during an in-flight poll (stale result) | The `queue` decision triggers a refetch after the in-flight request. |
| `setAppBadge` unsupported or rejects | Ignored. iOS only supports it after "Tambah ke Layar Utama" (N3). |
| Sessions kept alive forever by polling | Not an issue: the idle TTL equals the absolute TTL of 30 days (`src/lib/auth/constants.ts:21-23`). |
| Log volume (one line per poll) | Accepted. Estimated ≤ ~10k lines per school per day; deferred item in the backlog. |

**HRIS lessons applied:**
- One shared poller with in-flight dedupe and an explicit "refresh now" after self-inflicted changes (`useNotificationCounts.ts:83-131`).
- The interval is the dominant load lever, so set it per population (commit 142107f moved 18 → 40 s), and measure **query count**, not latency.
- Improvements over HRIS:
  - HRIS keeps its `setInterval` running while hidden (`NotificationBell.tsx:293-304`, 20 s) and has no backoff; N1 pauses and backs off.
  - HRIS keeps a second bell poller; N1 has one store for both the bell and the sidebar.
  - HRIS has no stale-account guard; N1 does.
- No server-side cache, so revocation and reads stay immediate. This matches HRIS choosing a per-request memo over a TTL cache.

## 10. Open questions (owner-level, with defaults)
1. **Student interval**: 60 s (default) or 30 s like staff? 60 s halves the load from the largest population. N3 Web Push will make it near-instant anyway.
2. **Demo badge**: show 3 sample unread items (default; shows off the feature, and it stays 3 because demo never saves), or keep 0 as today?
