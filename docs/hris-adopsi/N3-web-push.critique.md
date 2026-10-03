# Kritik adversarial — N3-web-push

Verdict: Needs revision before implementation. There is one blocker: built exactly as written, the CI gate goes red in four places (error-status guard, two lint errors, web push "off" in every test environment), and N4's own test also breaks. There are four majors. The upsert lock sequence inverts the global order, which creates a deadlock with login, password change and deactivation. The per-tab sync mark leaves a re-logged-in session with no subscription. Nobody clears the home-screen badge after reading or logout. The iPhone consequences (NEW_DEVICE review load, Safari↔PWA ping-pong) are described wrongly. The rest checks out against the code. Every cited path:line matches. The revoke enumeration is complete: revokeSession/revokeAllSessions/revokeSchoolSessions cover all their callers, plus the two `revokeReplacedSessions` updates, `releaseGraduates` and the maintenance cascade. The SSRF allowlist is sound. A service-worker PUT/POST to `/api/web` passes `sameOrigin`, because same-origin non-GET fetches carry `Origin` and the cookies are path `/api/web`. web-push 3.6.7 accepts every option used (`TTL`, `urgency`, `timeout`, `contentEncoding`, `vapidDetails`). The deploy helpers exist and `tsx` is installed on the VPS. "No nginx change" holds: live `curl` on 2026-10-03 shows `/sw.js`, `/zzz.png` and `/manifest.webmanifest` on studenthub.id and staging returning Next 404s with `x-nextjs-cache`.

1. **[blocker]** Implemented as written, the gate (lint, unit, int, e2e) fails.
   - Bukti:
     - (a) New error codes. `WEB_PUSH_DISABLED`, `WEB_PUSH_APP_SESSION` and `WEB_PUSH_ENDPOINT_INVALID` are thrown via `unprocessable(...)`. `src/lib/http/error-status.ts:11` says "Kode baru WAJIB ditambahkan di sini". `error-status.test.ts:58-66` and `:68-71` fail for any thrown or `contract.errors` code missing from `ERROR_STATUS`. Spec §2 never lists error-status.ts.
     - (b) `initialPushStatus` signature. Spec §2 says to keep the signature `initialPushStatus(role)` but always return PENDING. `role` then becomes an unused last argument, which `@typescript-eslint/no-unused-vars` reports as an error (`eslint.config.mjs:14`; only `^_` is ignored).
     - (c) `public/sw.js` is linted. `public/**` is not in `globalIgnores` (`eslint.config.mjs:25`); `public/vendor/*.js` is linted too, with errors silenced by an in-file directive. "Plain ES2017" rules out optional catch binding, and an unused `catch (e)` is an error. Verified: `eslint --stdin --stdin-filename public/sw.js` reports "'_e' is defined but never used" (caughtErrors are not ignored).
     - (d) Web push is "off" in every test environment. §4 checks the subject (`VAPID_SUBJECT ?? APP_ORIGIN` must be https/mailto) before the memory branch, and the memory variant carries `subject`. CI has `APP_ORIGIN: http://127.0.0.1:3030` (`ci-cd.yml:57`). `.env.example:24` / `.env.test` use `http://localhost:3030`. §2 only adds the two keys. Result: `mode:"off"/BAD_SUBJECT`, so PUT returns 422 `WEB_PUSH_DISABLED` in the integration tests and the E2E sees `enabled:false`.
     - (e) N4's test breaks. N4 lands first and asserts "Admin rows are SKIPPED" (`N4-attendance-notifications.md:177`, cf. `:133` "until N3"). §7 lists only three tests to update.
     - (f) E2E login. "Admin login → … PUT" needs an account without `mustChangePassword`. New admins are forced to change their password (403 `PASSWORD_CHANGE_REQUIRED`; `policy/index.ts:54-55`). The existing E2E handles this with a change-then-relogin helper (`e2e/sponsor-ads.spec.ts:35-40`).
   - Perbaikan:
     - Add the three codes to `ERROR_STATUS` (422) and list error-status.ts in §2.
     - Either drop `initialPushStatus` and write `pushStatus: "PENDING"` in notify.ts, or keep the function with `_role`, and update `rules.test.ts`.
     - Change the SW target to "ES2019 (optional `catch {}`)". iOS 16.4 and Chrome support it, and `node:vm` runs it.
     - Specify the branch order: no keys → off; `PUSH_TRANSPORT=memory` → memory, with no subject check; otherwise validate the subject. Or add `VAPID_SUBJECT: mailto:ci@studenthub.id` to the CI env and `setup.ts`.
     - Add N4's day-summary test to the §7 update list.
     - Say that pwa.spec.ts reuses the password-change helper, or uses a CLI-created super admin.

2. **[major]** The upsert lock sequence inverts the global lock order, which makes a deadlock with login, password change and deactivation possible. The new tx.ts line documents a wrong order.
   - Bukti:
     - Spec §5 locks `AuthSession` FOR UPDATE first, then inserts or updates `WebPushSubscription`. The FK check on `userId` takes a shared lock on the parent `User` row (InnoDB sets S record locks on parent rows for FK checks).
     - Login takes AppLock user → X(User) via `touchLastLogin` (`login-service.ts:279-280,318-324`) → X(AuthSession) when sessions are REPLACED or evicted (`session-service.ts:64-78`). Password change (`password-service.ts:98-107`) and deactivation (`users/service.ts:123-132`) also take AppLock user → X(User) → `revokeAllSessions`.
     - The cycle: the upsert holds X(S1) and waits for S(User); the other transaction holds X(User) and waits for X(S1).
     - `tx.ts:14` already fixes "AppLock user → … → User → AuthSession". The proposed "AuthSession (FOR UPDATE) → WebPushSubscription" ignores the implicit User lock.
     - withTx retries P2034, but CLAUDE.md requires following the global order. The race test (`Promise.all` of logout and PUT) never takes User, so it cannot catch this.
   - Perbaikan:
     - Upsert order: `lockUserSessions(tx, principal.userId)` (`session-service.ts:27-29`) first, then `lockRows(AuthSession)` and the re-read, then delete/upsert.
     - Document "Web Push: AppLock user → (User via FK) → AuthSession → WebPushSubscription" in tx.ts.
     - Moving a row away from another user (account switch) needs no lock on that user. That user's revoke only deletes rows still keyed to them.

3. **[major]** The once-per-tab sync mark is keyed by `userId`. After a same-user re-login in the same tab, the new session never gets a subscription, and push stops silently. This contradicts §9.9's "re-syncs silently".
   - Bukti:
     - §6: `ensureSubscribed` sets `sessionStorage studenthub_push_sync=<userId>`, and the bridge only syncs "if … this tab has not synced yet". Only `forgetWebPush()` (explicit logout) clears the mark.
     - Common revocations reach the tab as `studenthub:expired` (`use-session.ts:122`), which clears nothing. Examples: REPLACED by another attendance-device login (`device.ts:8-9`), session-limit eviction (`auth/constants.ts:29-34`), logout-all from another device, admin password reset.
     - Each of these revokes the old session, and N3 deletes its row. The user logs in again in the same tab or installed app, the mark still equals their id, and the new `sid` has no row. The Keamanan card then shows "Belum aktif" while permission is "granted".
   - Perbaikan:
     - Drive the sync from the server, per identity. On every identity change (`me.user.id` + login), `GET /me/web-push`. If `enabled && permission === "granted" && !subscribed`, run `ensureSubscribed`. Drop the mark, or clear it on `studenthub:expired` and on login.
     - If the server says not subscribed but the browser still holds a subscription, unsubscribe and resubscribe for a fresh endpoint. This avoids re-registering one that already got a 410.
     - Put the decision in `web-push-rules.ts` with tests.

4. **[major]** Nothing clears the app-icon badge after the user reads notifications or logs out, so an installed app shows a stale count indefinitely. This leaves a gap in the N1 handover.
   - Bukti:
     - The N1 critique (#6) removes `navigator.setAppBadge` from N1 and hands the badge to N3.
     - N3 sets it only in the SW `push` handler (§6), from the unread count at dispatch time.
     - Reading in the app (`markNotificationRead`/read-all) or logging out never touches it. On iPhone the home-screen icon is the main entry point (owner's condition), so "5" stays after everything is read, and on a shared phone (A2 NOT_ME) A's count stays for B.
     - Notifications already shown also stay in the tray and on the lock screen after logout. `forgetWebPush()` only unsubscribes.
   - Perbaikan:
     - Make the page the second writer. In the bridge, subscribe to the N1 `unreadBadge` snapshot. When `"setAppBadge" in navigator` and permission is granted, call `setAppBadge(n)` / `clearAppBadge()`. Use a pure `appBadgeAction`-style rule with tests.
     - `forgetWebPush()`: `clearAppBadge()`, and `registration.getNotifications()` → `close()` for each.
     - State in §9.14 that the SW writes on push and the page writes on every count change and on logout.

5. **[major]** The spec misstates what happens to students on iPhone. The NEW_DEVICE flag is not "informational" or "one-time", and switching between Safari and the installed app kills push.
   - Bukti:
     - `NEW_DEVICE` is MEDIUM (`anomaly-rules.ts:43`). `hasAnomaly = hasReportableAnomaly(flags)` (`check-in-service.ts:280`, `anomaly-rules.ts:122`) is true for any non-LOW flag.
     - B1 queues every `hasAnomaly` record for review, makes no change to flag detection, and only LOW-only rows return `NO_ANOMALY` (`B1-anomaly-review.md:7,11,17,324`). N4's day summary counts those rows as "anomali menunggu tinjauan".
     - `isNewDevice` flags every check-in for 7 days after a rebind (`anomaly-rules.ts:132-136`), so about 5 rows per student who installs, not one.
     - Logging in from the home-screen app rebinds the device and REPLACES the Safari session (`device.ts:8-9,72-82`). A later Safari login (for example a WhatsApp link opening in Safari) does the reverse: it REPLACES the PWA session, and N3's revoke-delete removes that session's push row, with another week of NEW_DEVICE.
     - The install copy ("masuk sekali lagi") states no consequence, which breaks the owner's cause→effect copy rule (A2 critique #1).
   - Perbaikan:
     - Rewrite §9.2 with these facts and a volume estimate (iPhone students × ~5 flagged check-ins in the first week).
     - Add an owner open question: accept the review load, or have B1/N4 skip NEW_DEVICE-only rows (a B1 change).
     - Extend install step 3: "Setelah ini selalu buka dari ikon ini. Masuk lewat Safari akan mengeluarkan aplikasi di layar utama dan mematikan notifikasinya."
     - Mirror it in FRONTEND.md and PLAN.

6. **[minor]** The `webPathOf` table does not match the screens the templates actually produce, so the headline admin push falls back to `/hub/notifications`.
   - Bukti:
     - Admin `LEAVE_SUBMITTED` uses `screen: "leave-request"` (`templates/attendance-leave.ts:15,56`; sent by `notifySchoolAdmins` at `leave-service.ts:233-236`). The SCHOOL_ADMIN row maps `leave-review`, which no template produces. The admin prompt copy itself advertises "Pengajuan izin".
     - N4 (merged earlier) adds `attendance-alpha` for STUDENT and `attendance-day` for SCHOOL_ADMIN (`N4-attendance-notifications.md:97-99`). Neither is mapped.
     - For N5's `?absen=1&notif=…`, `attendance-page.tsx:45-46` wipes the whole query with `history.replaceState`. A bridge `router.replace` built from a mount-time snapshot can therefore bring `absen=1` back.
   - Perbaikan:
     - Map SCHOOL_ADMIN `leave-request` → attendance, `attendance-alpha` → my-leave (the CTA is "ajukan izin"), and `attendance-day` → attendance.
     - Add a test that scans the `screen:` literals in `src/lib/notifications/templates/**` and `nisn-release-notice.ts`, like the error-status scanner, and requires every (recipient role, screen) pair to be mapped or listed as a deliberate fallback.
     - Strip `notif` from the live `location` with `history.replaceState`, and add a test for the `?absen=1&notif=` combination.

7. **[minor]** The dispatcher's timing and error-handling claims are wrong in three places.
   - Bukti:
     - (a) web-push `timeout` is a socket-idle timeout, not a total timeout (`@types/web-push/index.d.ts:247-255`; `web-push-lib.js` sets `httpsOptions.timeout` + `on('timeout')`). So "⌈100/20⌉×5 s = 25 s" is not a bound.
     - (b) The lease comment uses the wrong budget. On the tick path the deadline can reach `ctx.now+50 s` (`tick-runner.ts:59`, `jobs/constants.ts:14`, `dispatch.ts:79`), while the lease is `ctx.now+120 s` (`claim.ts:38`). expo-server-sdk also retries 429 twice (`ExpoClient.js:52-72`). If the Expo and web halves of a chunk run one after the other, the stated invariant does not hold. Correctness survives only thanks to the single in-process mutex.
     - (c) An invalid p256dh point passes the PUT check (b64url length 80–100 only) and web-push's 65-byte check (`encryption-helper.js`). `http_ece` then throws a plain Error before the request. `classifyRequestError` maps that to retry `NETWORK_ERROR` (`push/rules.ts:89`), so every notification to that user retries 4× and the row is never cleaned up.
     - (d) "Each web ok → updateMany lastUsedAt" means one round trip per device.
   - Perbaikan:
     - Run the Expo and web halves with `Promise.all`, wrap each web send in a hard deadline (race with a timer, then `destroy`), and restate the invariant using the 50 s tick budget.
     - Validate p256dh at PUT (`createECDH("prime256v1").computeSecret(key)` in try/catch → 422 `WEB_PUSH_ENDPOINT_INVALID`).
     - Classify errors without `statusCode` that are not network errors (no `code` in ECONNRESET/ETIMEDOUT/…) as `fail`.
     - Use one `updateMany({ id: { in: okIds } })` per chunk.

8. **[minor]** Taking named exports from a lazy `import("web-push")` can yield `undefined` at runtime, and neither typecheck nor the specified tests would catch it.
   - Bukti:
     - Checked with the 3.6.7 tarball under native Node ESM `import()`. Named exports are only `WebPushError`, `supportedContentEncodings` and `default`; `sendNotification`, `getVapidHeaders` and `generateVAPIDKeys` exist only on `default` (`src/index.js` exports an object literal).
     - `@types/web-push` declares all of them as named exports, so typecheck passes.
     - §5 injects the sender, so no test runs the real loader.
     - Existing CommonJS externals use a static default import (`students/import/read-file.ts:2` `import ExcelJS from "exceljs"`).
   - Perbaikan: `const webpush = (await import("web-push")).default`, or a static default import. Add a unit test proving the default loader returns a callable `sendNotification`. `vapid-keys.test.ts` should go through the same path.

9. **[minor]** `ensure_vapid_keys` misreads blank values: an empty quoted key counts as present, and two empty unquoted keys stop the deploy.
   - Bukti:
     - `^VAPID_PUBLIC_KEY=.+` matches `VAPID_PUBLIC_KEY=""`, the repo convention for blanks (`.env.example:33`, `bootstrap-vps.sh:258`; §8 adds VAPID_* to .env.example). The deploy then logs "sudah ada" and push stays off for good, unless `env.ts` turns "" into undefined like `EXPO_ACCESS_TOKEN` (`env.ts:33`). If it doesn't, `getEnv` throws at boot.
     - Two unquoted empty lines → `pub=1, priv=1` → `sh_die`, even though there is nothing to preserve.
     - The rest is fine: `run_step`/`sh_log`/`sh_die` exist (`remote-deploy.sh:170-175`, `common.sh:15-17`). Install is `--frozen-lockfile`, not `--prod` (`:187`), so `pnpm exec tsx` works (already used at `:120`). Next loads `.env` itself (`ecosystem.config.cjs:12`).
   - Perbaikan:
     - Move the decision into `scripts/deploy/vapid-keys.ts`. Load `.env` with dotenv `quiet` (`cli-env.ts:17`) and validate with `isVapid*`. Exit 0 when a valid pair exists, 3 when both are absent or blank (print the two lines), 2 when partial or invalid (`sh_die`).
     - The bash side only branches on the exit code.
     - In `env.ts`, map "" to undefined.
     - Test all three exits.

10. **[minor]** The CI gates have blind spots for a stale catalog and for coverage, and the spec mounts a hook inside JSX.
    - Bukti:
      - Stale catalog: `/api/web` only forwards operations in `catalog.json` (`route.ts:3,21-23,106`). No test compares the catalog with `openapi.json`, and the E2E calls `/api/v1` directly with Bearer tokens (`e2e/sponsor-ads.spec.ts:30-32`). A forgotten `pnpm frontend:sync` therefore ships a 404 for every real browser PUT.
      - Coverage: `.c8rc.json` counts all `src/**/*.ts` (`all:true`). `src/lib/frontend/web-push-client.ts` and `src/components/hub/web-push-bridge.ts` are browser-only and §7 lists no tests for them.
      - Mounting: §2 says to mount `useWebPushBridge()` "inside the provider" (`hub.tsx:105-117`). A hook cannot be called inside JSX or after the early returns at `hub.tsx:98-101`.
    - Perbaikan:
      - Add a unit assertion that `operations` contains `getMyWebPushStatus`, `upsertMyWebPushSubscription` and `removeMyWebPushSubscription`.
      - Make the bridge a `<WebPushBridge />` component in a `.tsx` file (outside c8), and move its decisions into `web-push-rules.ts`.
      - Run `pnpm coverage` before merging.

11. **[minor]** The prompt UX nags and can collide with other dialogs, and some copy is wrong off-phone.
    - Bukti:
      - "Nanti saja" is stored in `sessionStorage` (§6), so the sheet comes back on every new tab or app launch. `blocked` mode re-opens every session for users who chose Block, which contradicts the backlog row that defers re-prompting.
      - No stacking rule. The sheet can open together with the auto-opened CheckInFlow (`?absen=1`, `attendance-page.tsx:45-48`), the A2 identity card or an ActionDialog.
      - "Notifikasi aktif. Kabar baru muncul di HP ini." and "HP ini belum bisa…" are also used by the Keamanan card on desktop.
      - The manifest's `orientation: "portrait"` locks the installed admin dashboard on tablets.
    - Perbaikan:
      - Store the deferral in `localStorage` with a timestamp (e.g. 7 days), in a pure rule with tests.
      - Never auto-show `blocked`; the card covers it.
      - Show the sheet only on the dashboard and only when no dialog is open.
      - Use "perangkat ini" when `!device.mobile`.
      - Drop `orientation`.

12. **[minor]** N5 coordination is incomplete: TTL ignores N5's expiry, and N5's device loader can disagree with the dispatcher.
    - Bukti:
      - TTL: N5 adds `pushExpiresAt` (bell time) and only enforces it at claim time (`N5-attendance-reminders.md:31,186`). N3's `webPushTtlSeconds(createdAt, now)` allows up to 3 600 s, so a phone that is offline at 06:45 can show "Kamu belum absen… Jam masuk pukul 07:00" after 07:00.
      - Device loader: §9.14 has N5 call `loadDevices(…, { web: true })`. When web push is off (`getWebPushTransport()` returns null), the dispatcher uses `web:false`. N5 then plans reminders that end as SKIPPED `NO_DEVICE` and inflates `pushReadyStudentCount`. N5 itself asks for "whatever loader processClaim uses" (`N5…:25`).
    - Perbaikan:
      - TTL: `webPushTtlSeconds(createdAt, now, expiresAt?: Date | null)` = clamp(min(3600 − age, expiresAt − now), 60, 3600). N5 passes the row's `pushExpiresAt`.
      - Device loader: export `loadReachableDevices(userIds, now)` (the web flag comes from the transport) and use it in both `processClaim` and N5.
