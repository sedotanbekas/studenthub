# Student Hub design: authentication, sessions, RBAC, tenant isolation, provisioning and super admin

This is a design only. I read these lims-sotoy files to reuse its conventions: `src/lib/auth.ts`, `api-permission.ts`, `login-rate-limit.ts`, `app/api/auth/login/route.ts`, `db.ts` and `excel-import.ts`. I wrote no files.

Four places where I depart from what was given are called out:
- **D4:** `tokenVersion` is dropped.
- **D11:** the lims IP handling has a flaw.
- **D12:** there are two bcrypt costs.
- **D14:** a student's NISN is claimed at activation, not at creation.

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **One** `POST /auth/login` endpoint with an `identifier` field. Exactly 10 digits means NISN; anything else is treated as an email. | One code path handles rate limiting, timing equalisation and session creation. The NISN path can only find STUDENT accounts and the email path excludes STUDENT, so a login can never land on the wrong role. |
| D2 | The `platform` field picks the transport. `WEB` gets httpOnly cookies and never sees a token in the response body. `ANDROID`/`IOS` get Bearer tokens in the body and no cookies. Any role may use either. | The Expo app needs Bearer and the dashboards need cookies. People testing through the docs page log in with `platform=ANDROID` and paste the token into Authorize. |
| D3 | The access token is an HS256 JWT made with jose, valid 15 minutes. Its claims are only `sub, sid, iss, aud, iat, exp`. It carries no role or school. | Role and tenant are read from the database on every request, so changes take effect at once. The short lifetime limits damage from a leaked token. |
| D4 | Each authenticated request does **one** lookup: `AuthSession(sid)` joined with User, School, Student and Sponsor. **This replaces `User.tokenVersion`.** | Logging out one device, deactivating a user, changing a password or deactivating a school all take effect on the next request. `tokenVersion` could not kill a single device's session, and keeping two revocation mechanisms is redundant. |
| D5 | The refresh token is 32 random bytes, stored only as a SHA-256 hash. It rotates on every use, marked used through a compare-and-set on `rotatedAt`. Reusing an old token **more than 30 s** after rotation revokes the whole session. Reuse **within** 30 s returns 409 and issues no tokens. | This is standard reuse detection. The grace window absorbs the mobile app firing two refreshes in parallel. |
| D6 | CSRF protection on the cookie transport uses a per-session token, `HMAC(CSRF_SECRET, sid)`, sent in `X-CSRF-Token`. The server also checks `Origin` and `Sec-Fetch-Site` on unsafe methods. The access cookie is SameSite=Lax; the refresh cookie is SameSite=Strict with `Path=/api/v1/auth`. Bearer requests skip CSRF. **No CORS at all.** | The token is tied to the session, so cookie injection from a subdomain does not help an attacker. Without CORS, a cross-site page cannot send an `Authorization` header. |
| D7 | Auth is enforced inside a route wrapper, `apiRoute({ action, ... })`, not in `proxy.ts` (Next 16's replacement for middleware). | The check needs the database. A declaration on every route can be verified by a test that scans all routes. |
| D8 | Keep the lead's fixed role enum and a code-level `POLICY` map. Actions are named `<domain>.<verb>`. Defaults are secure: a STUDENT action is allowed only for status `ACTIVE` and a SPONSOR action only for status `APPROVED`, unless the rule says otherwise. | Read-only access for GRADUATED students and SUSPENDED sponsors then has to be opted into explicitly. |
| D9 | Tenant isolation uses a branded `SchoolScope` type that every repository function takes as its first argument. It can only be built by `resolveSchoolScope`. An id from another tenant returns **404**. I rejected a Prisma auto-filter extension. | A plain string cannot be passed by mistake. The auto-filter is implicit and misses raw SQL and nested writes. |
| D10 | Rate limiting runs in memory, behind a `RateLimiter` interface. PM2 must run **one fork-mode instance**. | No new infrastructure is needed. A restart resets the counters, which is acceptable. A Redis implementation can drop in if the app ever runs in cluster mode. |
| D11 | The client IP comes from `X-Real-IP`, which nginx sets with `$remote_addr` and so overwrites anything the client sends. If it is absent, use the **last** `X-Forwarded-For` hop. | **Flaw in lims:** it uses the **first** XFF hop, which the client controls. Rotating fake XFF values bypasses its login limiter. Do not copy that code. |
| D12 | Human-chosen and admin-typed passwords use bcryptjs **cost 10**. System-generated temporary passwords (10 characters, about 49.5 bits) use **cost 6**. `compare` handles any cost. | bcryptjs is pure JavaScript. Hashing 1,000 imported students at cost 10 takes about 100 s single-threaded; at cost 6 it takes about 5 s. Cracking a random 49-bit secret offline at cost 6 is still infeasible. |
| D13 | While `mustChangePassword` is set, every action returns 403 `PASSWORD_CHANGE_REQUIRED` except an allowlist: me, change-password, logout, refresh, sessions and push-token. A password change keeps the current session and revokes all others. | This matches the spec's forced change at first login. |
| D14 | **`Student.activeNisn` is claimed at ACTIVATION, not at creation.** It is NULL while the student is DRAFT or MOVED. | A typo in a DRAFT cannot knock a real graduated student off their account. Two schools may both hold a DRAFT for the same NISN; the first to activate wins. |
| D15 | `POST /students` defaults to `activate=true`: create, validate and activate in one step. If required data is missing it returns 422 and writes nothing. `activate=false` saves a DRAFT. | This follows "validasi data wajib sebelum aktivasi" with the fewest steps for the admin. |
| D16 | Bulk import runs in two steps: `dryRun=true` produces a report, then `dryRun=false` re-validates and commits. The commit is **all-or-nothing** and v1 only creates students. | With a partial import, admins must work out which rows landed, and re-uploading the fixed file collides on NISN. All-or-nothing makes "fix the file and upload again" safe. |
| D17 | For a single create or reset, the admin may type an initial password (checked against the policy, cost 10). Otherwise the system generates one and returns it **once**, with `no-store`. Import always generates passwords and can return them as an XLSX credential sheet. | The spec says the admin sets the initial password. Generated passwords are safer and can be printed. |
| D18 | A user's `role`, `schoolId` and `sponsorId` cannot change after creation. Only name and email are editable. | Moving someone to another school means deactivating the old account and creating a new one. This keeps audit and ownership rules simple. |
| D19 | Only SUPER_ADMIN may edit a school's location, geofence, timezone, NPSN and name. SCHOOL_ADMIN may edit the schedule minutes, school days, late tolerance and bank account. | A school admin cannot widen the geofence to make remote check-ins look valid. |
| D20 | The super admin creates a Sponsor (status PENDING) together with its first SPONSOR user, then approves, suspends or reinstates it as separate actions. PENDING and SUSPENDED sponsors can log in **read-only**. | This implements the spec's approval workflow and is ready if sponsors can later register themselves. |
| D21 | One active account per mobile device: logging in with a `deviceId` revokes other live sessions on that device (reason `REPLACED`). Each role also has a cap on active sessions, and the oldest is evicted. | This keeps push notifications going to the right account and makes checking in for a friend harder. It is only a heuristic, because the client supplies the device id. |
| D22 | GRADUATED students can log in, read-only. DRAFT, INACTIVE and MOVED students cannot log in. The service keeps `User.isActive` in step with the student status, **and** `getAuth` checks `Student.status` again. | Defence in depth, at no extra cost because the row is already joined. |
| D23 | Failed logins are never written to the database (the lims reasoning). Successful logins are recorded as `AuthSession` rows. Security events go to `AuditLog` in the same transaction as the change. | Attackers cannot use failed logins to load the database, and the audit trail is atomic. |
| D24 | The first SUPER_ADMIN is created by a CLI script on the VPS (`pnpm admin:create-super`), never by a migration or seed. The last active SUPER_ADMIN cannot be deactivated. An admin cannot reset or deactivate their own account through the admin endpoints. | No password hash ends up in git, and the platform cannot be locked out. |
| D25 | Errors use the envelope `{success:false, data:null, error:{code,message,details?}}`. 400 `VALIDATION_ERROR` means the request shape failed zod. 422 means a business rule failed. 404 covers ids in other tenants. | Clients can tell a malformed request from a business rejection, and the 404 reveals nothing about other schools. |
| D26 (proposal to the lead) | Resource paths are flat (`/students`, `/schools/{id}`) with scope taken from the session. The super admin passes `schoolId` in the query for lists and in the body for creates. Operations by id need no `schoolId`. | This should be one convention across all domains. |

## 2. Endpoints

All paths are under `/api/v1`. **SA** = SUPER_ADMIN and **SCA** = SCHOOL_ADMIN. `(*)` marks endpoints that stay allowed while `mustChangePassword` is set. Every `/auth/*` response, and any response containing `temporaryPassword`, carries `Cache-Control: no-store`.

| METHOD | PATH | ROLE(S) | Purpose | Key request | Key response |
|---|---|---|---|---|---|
| POST | /auth/login | public | Log in with NISN or email | identifier, password, platform (ANDROID/IOS/WEB), deviceId?, deviceName? | Bearer: accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt. WEB: sets cookies `sh_at`, `sh_rt`, `sh_csrf` and returns csrfToken, accessTokenExpiresAt. Both: user{id,name,role,schoolId,sponsorId,sponsorStatus?}, mustChangePassword |
| POST | /auth/refresh | public (refresh token) | Rotate the refresh token | mobile: refreshToken. web: `sh_rt` cookie + X-CSRF-Token | same as login |
| POST | /auth/logout | any (*) | Revoke the current session, clear its push token and cookies | – | {revoked:true} (idempotent) |
| POST | /auth/logout-all | any (*) | Revoke all of the caller's sessions | – | {revokedCount} |
| GET | /auth/me | any (*) | Identity, scope and permissions | – | user, role, school{id,name,timezone}, student{id,nisn,nis,status,class}, sponsor{id,companyName,status}, mustChangePassword, permissions[] |
| POST | /auth/change-password | any (*) | Voluntary or forced first change | currentPassword, newPassword | {changed:true, otherSessionsRevoked} |
| GET | /auth/sessions | any (*) | List the caller's own devices | – | [{id,platform,deviceName,ipAddress,lastUsedAt,createdAt,isCurrent}] |
| DELETE | /auth/sessions/{id} | any (*) | Revoke one of the caller's sessions | – | {revoked:true}; another user's session returns 404 |
| PUT | /auth/push-token | any (*) | Attach an Expo push token to the current session | expoPushToken | {registered:true} |
| DELETE | /auth/push-token | any (*) | Remove the push token | – | {removed:true} |
| GET | /regions/provinces | SA, SCA, SPONSOR | Province reference data | – | [{code,name}] |
| GET | /regions/provinces/{code}/cities | SA, SCA, SPONSOR | Cities of one province | – | [{code,name}] |
| GET | /schools | SA | List and search schools | q, provinceCode, cityCode, isActive, page, limit | rows{id,npsn,name,city,isActive,activeStudentCount}, meta |
| POST | /schools | SA | Create a school with geofence and schedule | npsn?, name, address?, provinceCode, cityCode, latitude, longitude, geofenceRadiusM, timezone, checkInOpenMinute, startMinute, lateToleranceMinutes, checkInCloseMinute, dayEndMinute, schoolDaysMask, bankName?, bankAccountNumber?, bankAccountHolder? | school |
| GET | /schools/{id} | SA; SCA (own school only) | School detail | – | school + counts{studentsByStatus, admins} |
| PATCH | /schools/{id} | SA | Edit any field, including location, geofence and timezone | any field from create | school |
| PATCH | /schools/{id}/settings | SA; SCA (own school) | Edit schedule and bank account | the 5 schedule minutes, lateToleranceMinutes, schoolDaysMask, bank* | school |
| POST | /schools/{id}/deactivate | SA | Block the whole school | reason | {isActive:false, revokedSessions} |
| POST | /schools/{id}/reactivate | SA | Re-enable the school | – | {isActive:true} |
| GET | /admin/users | SA | Search all users | q (name/email/NISN), role, schoolId, sponsorId, isActive, page, limit | rows{id,name,email,role,school,sponsor,isActive,mustChangePassword,lastLoginAt}, meta |
| POST | /admin/users | SA | Create a SCHOOL_ADMIN, a SPONSOR member or a SUPER_ADMIN (students are created via /students) | role, name, email, schoolId (SCHOOL_ADMIN), sponsorId (SPONSOR), initialPassword? | user, temporaryPassword? |
| GET | /admin/users/{id} | SA | User detail | – | user + activeSessionCount |
| PATCH | /admin/users/{id} | SA | Edit name or email only | name?, email? | user |
| POST | /admin/users/{id}/deactivate | SA | Disable a non-student account immediately | reason | {isActive:false, revokedSessions} |
| POST | /admin/users/{id}/activate | SA | Re-enable a non-student account | – | {isActive:true} |
| POST | /admin/users/{id}/revoke-sessions | SA | Force logout | reason? | {revokedCount} |
| POST | /users/{id}/reset-password | SA (any user except self); SCA (STUDENT users of own school) | Admin password reset | newPassword? | {mustChangePassword:true, temporaryPassword?} (only when generated) |
| GET | /students | SA (no schoolId means all schools), SCA | Student table with search, filter and pagination | schoolId?, q (name/NIS/NISN), classId, status, page, limit, sort | rows{id,nisn,nis,name,gender,class{id,name},status,isComplete}, meta |
| POST | /students | SA (schoolId required), SCA | Create a student account, optionally activating it | schoolId?, nisn, nis, name, gender, birthPlace?, birthDate?, address?, guardianName?, guardianPhone?, currentClassId?, initialPassword?, activate=true | student, temporaryPassword?, activationGaps[] |
| GET | /students/{id} | SA, SCA | Student detail | – | student, user{isActive,mustChangePassword,lastLoginAt}, activationGaps[] |
| PATCH | /students/{id} | SA, SCA | Update biodata or class | same fields as create (SCA may change nisn only while DRAFT) | student, activationGaps[] |
| POST | /students/{id}/activate | SA, SCA | Check required data and claim the NISN | – | student + releasedFrom?{schoolName}; 422 `ACTIVATION_INCOMPLETE`{gaps}; 409 `NISN_ACTIVE_ELSEWHERE` |
| POST | /students/{id}/status | SA, SCA | Change status to ACTIVE, INACTIVE, GRADUATED or MOVED | status, reason | student |
| DELETE | /students/{id} | SA, SCA | Hard delete, DRAFT only | – | {deleted:true}; any other status returns 409 |
| GET | /students/import/template | SA, SCA | XLSX template, with a second sheet listing class names | schoolId? (SA) | xlsx file |
| POST | /students/import | SA, SCA | Bulk import from CSV or XLSX | multipart: file, activate=true, dryRun=true, schoolId? (SA); query format=json\|xlsx | report{totalRows,validRows,errorRows,warningRows,rows[{row,nisn,name,errors[],warnings[]}]}. On commit also: created, credentials[{row,nisn,nis,name,className,temporaryPassword}], or an XLSX file |
| GET | /admin/sponsors | SA | List sponsors | status, q, page, limit | rows{id,companyName,status,balance,adCount}, meta |
| POST | /admin/sponsors | SA | Create a sponsor and its first user | companyName, contactName, contactEmail, contactPhone, address?, account{name,email,initialPassword?}, approveImmediately=false | sponsor, user, temporaryPassword? |
| GET | /admin/sponsors/{id} | SA | Sponsor detail | – | sponsor, members[], balance |
| PATCH | /admin/sponsors/{id} | SA | Edit company or contact fields | company and contact fields | sponsor |
| POST | /admin/sponsors/{id}/approve | SA | PENDING to APPROVED | note? | sponsor |
| POST | /admin/sponsors/{id}/suspend | SA | PENDING or APPROVED to SUSPENDED | reason (required) | sponsor |
| POST | /admin/sponsors/{id}/reinstate | SA | SUSPENDED to APPROVED | note? | sponsor |
| GET | /admin/platform-settings | SA | Read platform settings | – | settings |
| PATCH | /admin/platform-settings | SA | Set cost per click, minimum top-up and top-up bank account | defaultCpcAmount?, minTopUpAmount?, topUpBankName?, topUpAccountNumber?, topUpAccountHolder? | settings |
| GET | /audit-logs | SA (all schools); SCA (own school, enforced) | Audit trail | actorId, schoolId (SA), entityType, entityId, action, from, to, page, limit | rows{id,createdAt,actor{id,name,role},action,entityType,entityId,before,after,ipAddress}, meta |
| POST | /internal/jobs/auth-cleanup | cron (X-Job-Secret + loopback only) | Prune old tokens and sessions | – | {deletedTokens, deletedSessions} |

## 3. Business rules and algorithms

### Constants

```ts
// src/lib/auth/constants.ts
ACCESS_TOKEN_TTL_SEC = 900; JWT_ALG = "HS256"; JWT_ISSUER = "studenthub"; JWT_AUDIENCE = "studenthub-api"; JWT_CLOCK_TOLERANCE_SEC = 30
REFRESH_TOKEN_BYTES = 32
REFRESH_IDLE_TTL_MS     = { MOBILE: 30 * DAY, WEB: 12 * HOUR }
SESSION_ABSOLUTE_TTL_MS = { MOBILE: 180 * DAY, WEB: 7 * DAY }
REFRESH_RACE_GRACE_MS = 30_000
MAX_ACTIVE_SESSIONS = { STUDENT: 2, SCHOOL_ADMIN: 5, SPONSOR: 5, SUPER_ADMIN: 3 }
ROTATED_TOKEN_RETENTION_DAYS = 30; DEAD_SESSION_RETENTION_DAYS = 90
BCRYPT_COST = 10; TEMP_PASSWORD_BCRYPT_COST = 6
TEMP_PASSWORD_LENGTH = 10; TEMP_PASSWORD_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"   // 31 chars, ~49.5 bits
PASSWORD_MIN_LENGTH = 8; PASSWORD_MAX_BYTES = 72                                       // bcrypt truncates beyond 72 bytes
LOGIN_FAILURE_MIN_MS = 300
COOKIE_NAMES (prod) = { access: "__Host-sh_at", csrf: "__Host-sh_csrf", refresh: "__Secure-sh_rt" }  // dev: sh_at / sh_csrf / sh_rt
// src/lib/rate-limit/limits.ts          { limit, windowMs, lockMs? }            key
LOGIN_PAIR      = { 8,   10 min, 15 min }   "login:pair:<ip>::<normalizedIdentifier>" (failures only)
LOGIN_IP        = { 200, 10 min, 15 min }   "login:ip:<ip>" (failures only; high because a school's WiFi is one NAT IP)
REFRESH_IP      = { 60,  1 min }            "refresh:<ip>"
CHANGE_PASSWORD = { 5,   15 min, 15 min }   "chpw:<userId>" (wrong current password only)
ADMIN_RESET     = { 30,  60 min }           "reset:<actorId>"
CHECK_IN        = { 6,   5 min }            "checkin:<userId>" (all attempts)
UPLOAD          = { 30,  10 min }           "upload:<userId>"
IMPORT          = { 10,  60 min }           "import:<userId>"
RATE_LIMIT_MAX_KEYS = 100_000               // sweep expired entries once size > 10_000
// src/lib/students/constants.ts
NISN_PATTERN = /^\d{10}$/ (and not "0000000000"); NIS_PATTERN = /^[A-Za-z0-9./-]{1,20}$/
NAME_MIN = 3; NAME_MAX = 100; ADDRESS_MIN = 10; ADDRESS_MAX = 500
STUDENT_AGE_MIN = 5; STUDENT_AGE_MAX = 25
GUARDIAN_PHONE_PATTERN = /^(?:\+62|62|0)8[1-9]\d{6,10}$/   // stored normalised as "+628..."
IMPORT_MAX_FILE_BYTES = 2 MiB; IMPORT_MAX_UNCOMPRESSED_BYTES = 25 MiB; IMPORT_MAX_ROWS = 1000
IMPORT_TX = { timeout: 60_000, maxWait: 10_000 }
// src/lib/schools/constants.ts
GEOFENCE_RADIUS_MIN_M = 50; GEOFENCE_RADIUS_MAX_M = 1000; LATE_TOLERANCE_MAX_MIN = 120
INDONESIA_BOUNDS = { latMin: -11.5, latMax: 6.5, lngMin: 94.5, lngMax: 141.5 }; SCHOOL_DAYS_MASK_MIN = 1; SCHOOL_DAYS_MASK_MAX = 127
PAGE_LIMIT_DEFAULT = 20; PAGE_LIMIT_MAX = 100
CPC_MIN = 100; CPC_MAX = 100_000; MIN_TOPUP_FLOOR = 10_000; MIN_TOPUP_CEIL = 100_000_000
```

### Rules

1. **Login.**
   1. Parse the body with zod.
   2. `classifyIdentifier`:
      - trim;
      - `/^\d{10}$/` means NISN;
      - otherwise, if it contains `@` and passes `z.email()`, lowercase it and treat it as an email;
      - otherwise return 400.
   3. Check `LOGIN_PAIR` and `LOGIN_IP` before touching the database. A lock returns 429 `RATE_LIMITED` with `Retry-After`.
   4. Look up the account:
      - NISN: `Student where activeNisn = nisn` with `user(omit: { passwordHash: false })`, `school` and `sponsor`;
      - email: `User where email and role != STUDENT`.
   5. Run `bcrypt.compare` against the user's hash, or against `DUMMY_HASH` (cost 10) when no user was found.
   6. On failure:
      - record the failure on both limiters;
      - pad the response to `LOGIN_FAILURE_MIN_MS`;
      - return 401 `INVALID_CREDENTIALS` ("NISN/email atau kata sandi salah").
   7. On success, clear the pair counter.
   8. Run `checkLoginEligibility` (rule 2). If it fails, return 403 `ACCOUNT_INACTIVE` with a reason. This is revealed only after a correct password, so it cannot be used to discover accounts.
   9. Create the session (rule 3), sign the access token and respond according to the transport (D2).
   10. For `platform=WEB`, `Origin` must equal `APP_ORIGIN`, to prevent login CSRF.
2. **Login eligibility (pure).** Allowed only when all of these hold:
   - `user.isActive`;
   - if `schoolId` is set, `school.isActive`;
   - for STUDENT, `student.status ∈ {ACTIVE, GRADUATED}`;
   - for SPONSOR, the sponsor status can be anything (read-only enforcement happens in the policy).

   Reason codes: `USER_INACTIVE`, `SCHOOL_INACTIVE`, `STUDENT_DRAFT` ("Akun belum diaktivasi sekolah"), `STUDENT_INACTIVE`, `STUDENT_MOVED`.
3. **Creating a session**, in one transaction with retry on P2034:
   1. Create an `AuthSession` with `expiresAt = now + SESSION_ABSOLUTE_TTL[platformClass]`, plus the IP (max 45 chars), user agent (max 255), `deviceId` (`/^[A-Za-z0-9._:-]{8,100}$/`) and `deviceName` (max 100).
   2. If a `deviceId` was sent on a mobile platform: revoke other live sessions with the same `deviceId` (`REPLACED`, and set their `expoPushToken` to NULL).
   3. If the user now has more than `MAX_ACTIVE_SESSIONS[role]` live sessions, revoke the oldest by `lastUsedAt` (`REPLACED`).
   4. Create a `RefreshToken` with `expiresAt = min(now + REFRESH_IDLE_TTL, session.expiresAt)`.
   5. Set `user.lastLoginAt = now`.
4. **`getAuth(request)`.**
   1. Find the credential:
      - if an `Authorization: Bearer` header is present, use it (transport `bearer`); if that token is invalid, do **not** fall back to the cookie;
      - otherwise use the access cookie (transport `cookie`);
      - if there is neither, return `null`.
   2. Verify the JWT with `jwtVerify({ algorithms: ["HS256"], issuer, audience, clockTolerance })`. An expired token returns 401 `TOKEN_EXPIRED` (the client should refresh). Any other failure returns 401 `UNAUTHENTICATED`.
   3. Make one query: `authSession.findUnique({ id: sid, select: revokedAt, expiresAt, userId, platform, user { id, role, isActive, mustChangePassword, schoolId, sponsorId, school { isActive }, student { id, status }, sponsor { status } } })`.
   4. Run `evaluatePrincipal` (pure):
      - if the session is missing, revoked, past `expiresAt`, or `userId != sub`, return 401 `SESSION_INVALID`;
      - otherwise apply the rule 2 checks; a failure returns 401 `ACCOUNT_INACTIVE`.
   5. For the cookie transport with a method other than GET, HEAD or OPTIONS, run the CSRF check (rule 6).
   6. Return a frozen `Principal`.
   7. `getAuth` never writes; `lastUsedAt` is updated only on refresh.
5. **Refresh.**
   1. `hash = sha256hex(raw)`.
   2. Find the token by hash, including its session and user. If none is found, return 401 `SESSION_INVALID` and revoke nothing.
   3. `decideRefresh(token, session, now)` (pure) returns one of:
      - `REVOKED` or `EXPIRED`: return 401 `SESSION_INVALID`;
      - `RACE` (`rotatedAt` within `REFRESH_RACE_GRACE_MS`): return 409 `REFRESH_RACE`. Issue no tokens and do not revoke;
      - `REUSE` (rotated longer ago than the grace window): in one transaction, revoke the session (`TOKEN_REUSE`), set its push token to NULL and write the audit entry `auth.token_reuse` (with IP and user agent). Return 401 `SESSION_INVALID`;
      - `ROTATE`: continue.
   4. Check eligibility (rule 2). If it fails, revoke the session (`ACCOUNT_DISABLED`) and return 401 `ACCOUNT_INACTIVE`.
   5. In one transaction:
      1. `updateMany where { id, rotatedAt: null }` with `rotatedAt = now`. If the count is 0, run the decision again, which yields `RACE` or `REUSE`.
      2. Create the new token with `expiresAt = min(now + idle, session.expiresAt)`.
      3. Update the session's `lastUsedAt`, IP and user agent.
   6. Sign a new access token.

   Web refresh reads the refresh cookie and requires `X-CSRF-Token == HMAC(sid of the token's session)`.

   **Contract for the Expo client:** refreshes run single-flight behind a mutex. On 409, re-read the stored token and retry once. On a 401 with code `SESSION_INVALID` or `ACCOUNT_INACTIVE`, send the user to the login screen.
6. **CSRF.**
   1. `csrfToken = base64url(HMAC-SHA256(CSRF_SECRET, sessionId))`. It is returned in the login and refresh responses and also set in the readable CSRF cookie, which keeps the same attributes as the access cookie apart from httpOnly.
   2. On unsafe methods using the cookie transport:
      - the `X-CSRF-Token` header must match, compared with `timingSafeEqual`;
      - if `Origin` is present it must equal `APP_ORIGIN`;
      - if `Sec-Fetch-Site` is present it must be `same-origin` or `none`.
   3. Any failure returns 403 `CSRF_INVALID`.
   4. The Swagger or Scalar docs page adds the header in a `requestInterceptor` that reads it from the cookie.
7. **Revocation.**
   - `revokeSession(sid, reason)` and `revokeAllSessions(tx, userId, reason, exceptSid?)` both set `revokedAt` and `revokeReason` and set `expoPushToken` to NULL, using `updateMany where revokedAt IS NULL`. Both are idempotent.
   - Logout clears all three cookies, with `Max-Age=0` and matching Path.
8. **Push token.**
   - Format: `/^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/`, max 255 characters. It is accepted only on ANDROID and IOS sessions.
   - In one transaction:
     1. Set `expoPushToken` to NULL on any other session holding the same token (the same phone with the previous account).
     2. Set it on the current session.
   - Unique-constraint errors (P2002) on this path are retried once.
9. **Change password.**
   1. Check the `CHANGE_PASSWORD` limiter.
   2. Load the password hash. If `currentPassword` is wrong, record a failure and return **400** `CURRENT_PASSWORD_INVALID`. It is not a 401, so the client does not log the user out.
   3. `checkPasswordPolicy(new, { nisn, nis, email, name, birthDate })` checks:
      - length ≥ 8;
      - at most 72 UTF-8 bytes;
      - at least one letter and one digit;
      - the password does not contain the NISN, the NIS, the email local part, or the birth date as `ddmmyyyy` or `yyyymmdd`;
      - it is not on a small blocklist (`password1`, `12345678a`, `qwerty123`, and so on).

      Failure returns 422 `PASSWORD_POLICY` with a list of violations.
   4. If `compare(new, currentHash)` succeeds, return 422 `PASSWORD_REUSED`.
   5. Hash at cost 10, outside the transaction.
   6. In one transaction:
      - update the hash;
      - set `mustChangePassword = false` and `passwordChangedAt = now`;
      - run `revokeAllSessions(..., PASSWORD_CHANGED, except current)`;
      - write the audit entry `auth.password_change`.
10. **Admin reset.**
    1. Check the `ADMIN_RESET` limiter.
    2. Load the target with a scope:
       - SA may reset any user except themselves (self returns 400 `USE_CHANGE_PASSWORD`);
       - SCA may reset only a STUDENT user in their own school; anything else returns 404.
    3. Use the typed password (policy-checked, cost 10) or generate one (cost 6).
    4. In one transaction:
       - write the hash;
       - set `mustChangePassword = true` and `passwordChangedAt = now`;
       - revoke all sessions (`ADMIN_REVOKED`);
       - write the audit entry `user.reset_password`, which never includes the password.
    5. Echo the password only when it was generated.
11. **Deactivating and activating users (SA).**
    - STUDENT targets return 400 `USE_STUDENT_STATUS`, so that status and `isActive` stay in step through `/students/{id}/status`.
    - A user cannot target themselves.
    - Deactivating the last active SUPER_ADMIN returns 409 `LAST_SUPER_ADMIN`, checked after locking the SUPER_ADMIN rows with `FOR UPDATE`.
    - The transaction sets `isActive = false`, revokes all sessions (`ACCOUNT_DISABLED`) and writes the audit entry. The effect applies on the user's next request (D4).
    - Activation sets only `isActive = true`; users must log in again.
12. **Policy.**
    - Structure: `POLICY: Record<Action, { roles, studentStatuses?, sponsorStatuses?, allowDuringPasswordChange? }>`.
    - `authorize(principal, action)` checks, in order:
      1. the role is in `roles`, otherwise 403 `FORBIDDEN`;
      2. if `mustChangePassword` is set and the action does not allow it, 403 `PASSWORD_CHANGE_REQUIRED`;
      3. for STUDENT, the status is in `studentStatuses ?? ["ACTIVE"]`, otherwise 403 `STUDENT_READ_ONLY`;
      4. for SPONSOR, the status is in `sponsorStatuses ?? ["APPROVED"]`, otherwise 403 `SPONSOR_NOT_APPROVED`.
    - Actions in this domain:

      | Action | Roles |
      |---|---|
      | `auth.self` | all roles; allowed during password change; all student and sponsor statuses |
      | `region.read` | SA, SCA, SPONSOR (all sponsor statuses) |
      | `school.list`, `school.create`, `school.update`, `school.deactivate` | SA |
      | `school.read`, `school.settings.update` | SA, SCA |
      | `user.manage` | SA |
      | `user.resetPassword` | SA, SCA |
      | `student.read`, `student.manage`, `student.import` | SA, SCA |
      | `sponsor.account.manage` | SA |
      | `platform.settings.manage` | SA |
      | `audit.read` | SA, SCA |

    - Other domains append their own actions, for example `attendance.checkIn: { roles: [STUDENT] }` or `sponsor.analytics.read: { roles: [SPONSOR], sponsorStatuses: [PENDING, APPROVED, SUSPENDED] }`.
    - `/auth/me.permissions = listAllowedActions(principal)`.
13. **Tenant scoping (IDOR-safe).**
    1. `resolveSchoolScope(p, requestedSchoolId, mode)`:
       - SCA: returns `{ kind: "school", schoolId: p.schoolId }`. A requested `schoolId` that differs returns 403 `SCOPE_MISMATCH`, because that is the admin's own input and not an existence oracle.
       - SA writes: `schoolId` is required (400 `SCHOOL_ID_REQUIRED`), and the school must exist and be active (404 or 409 `SCHOOL_INACTIVE`).
       - SA reads: an absent `schoolId` gives `{ kind: "all" }`.
       - STUDENT and SPONSOR get 403.
    2. By-id access always uses `findFirst({ where: { id, ...schoolWhere(scope) } })`. A miss returns 404 `NOT_FOUND`, including for ids in another tenant. `findUnique({ where: { id } })` on a school-scoped model is banned, and a source-scan test enforces this.
    3. Every foreign id in a request body (for example `currentClassId`) is checked with `assertInSchool(tx, schoolId, "schoolClass", [ids])`. A miss returns 404 `CLASS_NOT_FOUND`.
    4. A child row's `schoolId` is copied from the parent row loaded under scope, never taken from the body.
    5. Students always act on `p.studentId` and sponsors on `p.sponsorId`. Ids for these are never accepted from the request body.
14. **Creating a student.**
    1. `schoolId` comes from the scope.
    2. Check uniqueness:
       - `(schoolId, nisn)` exists: 409 `NISN_ALREADY_IN_SCHOOL`;
       - `(schoolId, nis)` exists: 409 `NIS_ALREADY_IN_SCHOOL`.
    3. The class must be in the same school, active, and in the academic year of the school's active term, if the school has one.
    4. Compute `activationGaps`. If `activate=true` and there are gaps, return 422 `ACTIVATION_INCOMPLETE` and write nothing.
    5. Hash the password before the transaction.
    6. In one transaction:
       - create the User (STUDENT, `mustChangePassword = true`, `isActive = activate`);
       - create the Student (`status = activate ? ACTIVE : DRAFT`, `activeNisn` from rule 16 when activating, otherwise NULL);
       - write the audit entry.
    7. A P2002 error returns 409.
15. **Activation gaps (pure, `getActivationGaps(student, name, class, school, now)`).** Each gap is `{ field, code, message }`. Required:
    - name between 3 and 100 characters;
    - NISN and NIS valid;
    - gender;
    - birth place;
    - birth date, with age between 5 and 25 on the local date;
    - address between 10 and 500 characters;
    - guardian name;
    - guardian phone valid, normalised to `+62`;
    - class present, active, in the same school and the active year;
    - school active.

    An empty list means the student can be activated.
16. **Claiming the NISN** (activation, or reactivation from MOVED or GRADUATED), inside the transaction:
    1. `SELECT id, status, schoolId FROM Student WHERE activeNisn = ? FOR UPDATE`.
    2. `decideNisnClaim(holder, selfId)` (pure):
       - no holder, or the holder is this student: claim;
       - holder is GRADUATED: release the holder's `activeNisn` (set it to NULL), revoke the holder user's sessions, write the audit entry `student.nisn_release`, then claim;
       - holder is ACTIVE or INACTIVE: 409 `NISN_ACTIVE_ELSEWHERE` ("NISN masih aktif di sekolah lain; sekolah asal harus menandai Pindah/Lulus"). The other school's name is shown only to SA.
    3. A P2002 on the claim (two activations at once) returns 409.
17. **Student status transitions (pure `STUDENT_TRANSITIONS`).**

    | From | To | Effects |
    |---|---|---|
    | DRAFT | ACTIVE | runs the activate rules |
    | ACTIVE | INACTIVE | `isActive = false`, revoke sessions; `activeNisn` is kept |
    | INACTIVE | ACTIVE | gaps must be empty, then claim |
    | ACTIVE, INACTIVE | GRADUATED | `isActive = true`, read-only |
    | ACTIVE, INACTIVE, GRADUATED | MOVED | `activeNisn = NULL`, `isActive = false`, revoke sessions |
    | GRADUATED, MOVED | ACTIVE | must claim the NISN again |

    Any other transition returns 409 `INVALID_STATUS_TRANSITION`. A reason (3 to 255 characters) is required for everything except activation.
18. **Updating a student.**
    - Only fields in the patch are applied.
    - While the student is ACTIVE, the merged result must have no gaps, otherwise 422. Required data cannot be cleared from an active student.
    - SCA may change the NISN only while DRAFT; otherwise 409 `NISN_LOCKED`. SA may change it later: the claim runs again and sessions are revoked.
    - Changing the name updates `User.name`, because the student's name lives there.
19. **Deleting a student** is allowed only for DRAFT students with no dependent rows. It deletes both the Student and the User. Otherwise it returns 409 `STUDENT_NOT_DRAFT`.
20. **Import.**
    1. **Pre-checks.**
       - Content-Length and `file.size` must be at most 2 MiB, otherwise 413.
       - The file type is detected from magic bytes: the ZIP signature `PK\x03\x04` means XLSX; UTF-8 text means CSV (a BOM is stripped, and `,` or `;` is detected as the delimiter).
       - For XLSX, the uncompressed sizes in the ZIP central directory must total at most 25 MiB (zip-bomb guard), otherwise 422 `IMPORT_FILE_INVALID`.
       - Only the first sheet is read, and at most 1,000 data rows are allowed.
    2. **Headers.** Matching ignores case and extra spaces, and accepts these aliases: `nisn`, `nis`, `nama`/`nama lengkap`, `jenis kelamin`/`jk`, `tempat lahir`, `tanggal lahir`, `alamat`, `nama wali`, `no hp wali`/`hp wali`, and `kelas`.
       - Always required: `nisn`, `nis`, `nama`, `jenis kelamin`.
       - Also required when `activate=true`: all the other headers.
       - A missing header returns 422 before any rows are checked.
    3. **Cells.**
       - The `clean()` function from lims is reused.
       - A numeric NISN cell with 10 digits or fewer is left-padded with zeros, with the warning `NISN_ZERO_PADDED`.
       - Scientific notation is expanded.
       - Gender accepts `L/P/Laki-laki/Perempuan/M/F`.
       - Dates accept Date cells, Excel serial numbers, `DD/MM/YYYY`, `DD-MM-YYYY` and `YYYY-MM-DD`. Invalid dates such as 31/02 are errors.
       - Classes are matched by normalised name (uppercase, spaces collapsed) within the school's active academic year.
       - Fully empty rows are skipped.
       - Row numbers are the spreadsheet row numbers, with the header as row 1.
    4. **Checks.**
       - A duplicate NISN or NIS within the file is an error on **every** occurrence.
       - Three batched queries check against the database: NISNs already in this school (error), NIS already in this school (error), and `activeNisn` holders elsewhere. An ACTIVE or INACTIVE holder is an error; a GRADUATED holder is a warning ("akun lama akan dilepas").
       - With `activate=true`, each row must also have no activation gaps.
    5. **Dry run** returns the report and writes nothing.
    6. **Commit.**
       1. Re-parse and re-validate the file; results from the dry run are never trusted.
       2. If any row has an error, return 422 `IMPORT_INVALID` with the report and write nothing.
       3. Generate passwords and hash them at cost 6 before the transaction.
       4. Pre-generate user ids with cuid2, because Prisma has no `createManyAndReturn` on MySQL.
       5. In one transaction (`IMPORT_TX`):
          - lock the `activeNisn` holders with `FOR UPDATE` and release GRADUATED holders;
          - `createMany` the users;
          - `createMany` the students;
          - revoke the sessions of released holders;
          - write one audit entry, `student.import` (count, school, file sha256).
       6. A P2002 error returns 409 `IMPORT_CONFLICT` ("data berubah sejak validasi, ulangi validasi").
       7. Credentials are returned once, as JSON, or as XLSX with `format=xlsx`.
21. **Schools.**
    - Province and city codes must exist, and the city must belong to the province.
    - Latitude and longitude must fall within `INDONESIA_BOUNDS`.
    - Geofence radius must be between 50 and 1,000 m.
    - Schedule order: `0 ≤ open < start ≤ close ≤ dayEnd < 1440`.
    - Late tolerance must be between 0 and 120.
    - The school-days mask must be between 1 and 127.
    - NPSN is 8 digits, optional and unique (409).
    - Bank fields are all or none. The account number is 5 to 30 digits.
    - A PATCH is merged with the current row and then the **whole** result is validated.
    - Deactivating a school, in one transaction:
      - sets `isActive = false`;
      - revokes the sessions of all users of the school (`updateMany where: { revokedAt: null, user: { schoolId } }`);
      - writes the audit entry.
22. **Sponsors.**
    - On create, `account.email` must be unique (409 `EMAIL_TAKEN`). The transaction creates the Sponsor (PENDING, or APPROVED with `reviewedBy`/`reviewedAt` when `approveImmediately`) and the SPONSOR user (`mustChangePassword = true`).
    - Approve, suspend and reinstate are compare-and-set updates (`updateMany where { id, status: <expected from> }`). A count of 0 returns 409 `INVALID_STATUS`.
    - Each of these writes an audit entry and creates Notifications (`SPONSOR_APPROVED` or `SPONSOR_SUSPENDED`) for all sponsor users.
    - Suspension does **not** revoke sessions; it takes effect through the policy and the ad-serving rules.
23. **Platform settings.**
    - `defaultCpcAmount` must be between `CPC_MIN` and `CPC_MAX`, and `minTopUpAmount` between `MIN_TOPUP_FLOOR` and `MIN_TOPUP_CEIL`. Bank fields are all or none.
    - The singleton row (id 1) is updated and an audit entry records before and after.
    - Changes do not reprice live ads, because each ad keeps a snapshot of its cost per click.
24. **Audit.**
    - `writeAudit(tx, entry)` is always called inside the transaction that makes the change.
    - `redactForAudit` removes any key matching `/password|hash|token|secret/i`, at any depth.
    - Listing is ordered by `createdAt desc`, with `limit` at most 100. For SCA the scope forces their own `schoolId`.
25. **Rate limiter mechanics.**
    - It uses a fixed-window counter plus an optional lock, and an injectable clock.
    - `check(key)` runs before any expensive work.
    - Failure-only limiters call `recordFailure(key)`; the others call `hit(key)`.
    - A block returns 429 with `Retry-After = ceil(lockRemainingSec)`.
    - When the map reaches `RATE_LIMIT_MAX_KEYS`, expired entries are swept and then the oldest are dropped.
    - Deploy requirements: nginx must set `proxy_set_header X-Real-IP $remote_addr;`, and PM2 must run `instances: 1`, `exec_mode: fork`.
26. **Cleanup job** (`auth-cleanup`, run daily).
    - `JobRun` with key `("auth-cleanup", "global", localDate)` makes it idempotent.
    - It deletes RefreshTokens whose `rotatedAt` is older than 30 days or whose `expiresAt` is more than a day past.
    - It deletes AuthSessions that were revoked, or whose `expiresAt` passed, more than 90 days ago. Their tokens go by cascade.
    - The internal endpoint requires `timingSafeEqual(X-Job-Secret, JOB_SECRET)` **and** that the request did not come through nginx (no `X-Real-IP`, or a loopback address). Cron calls `http://127.0.0.1:<port>`.
27. **Startup validation (`src/lib/env.ts`, zod).**
    - Required: `JWT_ACCESS_SECRET` (at least 32 bytes), `CSRF_SECRET` (at least 32 bytes, different from the JWT secret), `JOB_SECRET`, `APP_ORIGIN` and `DATABASE_URL`. In production a missing value throws.
    - The process must run with `TZ=UTC`.
    - Rotating the JWT secret logs nobody out: refresh tokens are opaque database rows, so clients just refresh. No `kid` header is needed.

## 4. Service and pure modules

Pure modules have no Prisma import and are tested with `node:test`.
```
src/lib/auth/constants.ts
src/lib/auth/identifier.ts        classifyIdentifier(raw: string): {kind:"NISN";nisn:string}|{kind:"EMAIL";email:string}|{kind:"INVALID"}
src/lib/auth/password-policy.ts   checkPasswordPolicy(pw: string, ctx: PolicyCtx): PolicyViolation[]
                                  generateTempPassword(rand: (n:number)=>Uint8Array = randomBytes): string
src/lib/auth/eligibility.ts       checkLoginEligibility(a: EligibilityInput): {ok:true}|{ok:false;reason:IneligibleReason}
src/lib/auth/refresh-decision.ts  decideRefresh(t:{rotatedAt:Date|null;expiresAt:Date}, s:{revokedAt:Date|null;expiresAt:Date}, now:Date): "ROTATE"|"RACE"|"REUSE"|"EXPIRED"|"REVOKED"
                                  refreshExpiry(now:Date, platform:ClientPlatform, sessionExpiresAt:Date): Date
src/lib/auth/csrf.ts              csrfTokenFor(secret:Uint8Array, sid:string): string
                                  verifyCsrf(i:{method;header?;sid;origin?;secFetchSite?;appOrigin;secret}): boolean
src/lib/auth/principal.ts         type Principal; evaluatePrincipal(row: SessionRow|null, claims:{sub;sid}, now:Date): Principal|AuthFailure
src/lib/auth/policy.ts            POLICY (as const satisfies Record<string,PolicyRule>); type Action = keyof typeof POLICY
                                  authorize(p:Principal, a:Action): {ok:true}|{ok:false;status:403;code:string}
                                  listAllowedActions(p:Principal): Action[]
src/lib/tenant/scope.ts           type SchoolScope (branded); resolveSchoolScope(p, requested:string|undefined, mode:"read"|"write"): SchoolScope
                                  schoolWhere(s): {schoolId?:string}; requireSingleSchool(s): string
                                  studentSelf(p): {schoolId;studentId}; resolveSponsorScope(p, requested?): SponsorScope
src/lib/rate-limit/limiter.ts     createLimiter(cfg:LimitConfig, clock=()=>Date.now()): RateLimiter  // check/hit/recordFailure/reset
src/lib/rate-limit/limits.ts      named configs + limiter singletons (globalThis)
src/lib/http/client-ip.ts         clientIp(req: Request): string
src/lib/students/activation-rules.ts  getActivationGaps(i: ActivationInput, now: Date): ActivationGap[]
src/lib/students/status-rules.ts  STUDENT_TRANSITIONS; assertTransition(from, to): void; isLoginStatus(s): boolean
src/lib/students/nisn-rules.ts    decideNisnClaim(holder:{id;status}|null, selfId:string): "CLAIM"|"RELEASE_AND_CLAIM"|"CONFLICT"
src/lib/students/import/cell-parsers.ts  parseNisnCell, parseDateCell, parseGenderCell (reuses lims clean())
src/lib/students/import/validate-rows.ts validateImportRows(rows: RawRow[], ctx: ImportCtx): ImportReport
src/lib/schools/schedule-rules.ts validateSchoolConfig(c: SchoolConfig): FieldError[]; mergeSchoolPatch(cur, patch): SchoolConfig
src/lib/phone.ts                  normalizeIdPhone(raw: string): string|null
src/lib/audit/redact.ts           redactForAudit(v: unknown): unknown
```

Services and I/O modules:
```
src/lib/env.ts                    env (zod-validated)
src/lib/db.ts                     lims clone; global omit { user: { passwordHash: true } }
src/lib/db/tx.ts                  withTx<T>(fn:(tx)=>Promise<T>, opts?:{timeout;maxWait;retries=3}): Promise<T>  // P2034 retry
src/lib/http/errors.ts            class DomainError(status, code, message, details?); mapError(e): Response  // P2002→409, P2025→404, else 500 + log
src/lib/http/envelope.ts          ok(data, meta?), created(data), fail(status, code, message, details?)
src/lib/http/api-route.ts         apiRoute<B,Q,P>(def:{action:Action|typeof PUBLIC; params?; query?; body?: ZodType<B>|"multipart";
                                    limits?: LimitSpec[]; handler:(ctx:{req;principal;body;query;params;ip;now})=>Promise<Response>})
                                  → (req: NextRequest, ctx:{params:Promise<Record<string,string>>}) => Promise<Response>
src/lib/http/auth-cookies.ts      setAuthCookies(res, t:IssuedTokens), clearAuthCookies(res)
src/lib/auth/password-hash.ts     hashPassword(pw, cost=BCRYPT_COST), verifyPassword(pw, hash|null)  // null → DUMMY_HASH
src/lib/auth/access-token.ts      signAccessToken({sub,sid}, now): Promise<{token;expiresAt}>; verifyAccessToken(jwt): Promise<{sub;sid}>
src/lib/auth/get-auth.ts          getAuth(req: Request, now=new Date()): Promise<Principal|null>  // throws DomainError 401/403
src/lib/auth/login-service.ts     login(input: LoginInput, ctx: ReqCtx): Promise<IssuedTokens & {user; mustChangePassword}>
src/lib/auth/session-service.ts   createSession(tx, i), rotateRefresh(raw, ctx), revokeSession(sid, reason), revokeAllSessions(tx, userId, reason, exceptSid?),
                                  listOwnSessions(p), revokeOwnSession(p, sid), setPushToken(p, token), clearPushToken(p)
src/lib/auth/password-service.ts  changePassword(p, i), adminResetPassword(p, userId, i): Promise<{temporaryPassword?:string}>
src/lib/auth/me-query.ts          getMe(p)
src/lib/users/user-service.ts     createStaffUser(p, i), updateUser(p, id, i), setUserActive(p, id, active, reason?), forceLogout(p, id)
src/lib/users/user-queries.ts     searchUsers(p, q), getUserDetail(p, id)
src/lib/users/user-schemas.ts
src/lib/students/student-service.ts  createStudent(p, i), updateStudent(p, id, i), activateStudent(p, id), changeStudentStatus(p, id, i), deleteDraftStudent(p, id)
src/lib/students/nisn-claim.ts    claimNisn(tx, student, now): Promise<{releasedFromSchoolId?:string}>
src/lib/students/student-queries.ts  listStudents(scope, q), getStudent(scope, id)
src/lib/students/student-schemas.ts
src/lib/students/import/read-workbook.ts  readImportFile(buf: Buffer): Promise<RawRow[]>  // zip-size guard + exceljs/CSV
src/lib/students/import/import-service.ts validateImport(p, file, opts), commitImport(p, file, opts)
src/lib/students/import/template.ts, credentials-xlsx.ts
src/lib/schools/school-service.ts / school-queries.ts / school-schemas.ts
src/lib/regions/region-queries.ts
src/lib/sponsors/sponsor-account-service.ts  createSponsorAccount, updateSponsor, approveSponsor, suspendSponsor, reinstateSponsor
src/lib/platform/settings-service.ts         getSettings, updateSettings
src/lib/audit/audit-service.ts (writeAudit(tx, e)) / audit-queries.ts (listAuditLogs(scope, q))
src/lib/jobs/auth-cleanup.ts                  runAuthCleanup(now): Promise<CleanupResult>
scripts/create-super-admin.ts                 (pnpm admin:create-super --email --name; prints generated password once)
src/app/api/v1/**/route.ts                    each: export const METHOD = apiRoute({...}); handler < 50 lines
```

## 5. Test cases

### Unit tests (pure modules)

- **identifier:**
  - 10 digits classified as NISN;
  - surrounding spaces trimmed;
  - 9 or 11 digits invalid;
  - `0000000000` invalid;
  - email lowercased;
  - `+tag` emails accepted;
  - garbage rejected.
- **password-policy:**
  - 7 characters rejected;
  - more than 72 bytes rejected (multibyte and emoji counting);
  - letters only rejected;
  - digits only rejected;
  - containing the NISN, NIS, email local part or birth date (`ddmmyyyy`, `yyyymmdd`) rejected;
  - blocklisted passwords rejected;
  - valid password accepted.
- **generateTempPassword:**
  - output length and alphabet;
  - always contains a letter and a digit;
  - deterministic with an injected RNG.
- **eligibility:**
  - inactive user;
  - inactive school;
  - DRAFT, INACTIVE and MOVED students denied;
  - GRADUATED allowed;
  - PENDING and SUSPENDED sponsors allowed.
- **decideRefresh:**
  - fresh token gives ROTATE;
  - expired token;
  - revoked session;
  - session past its absolute limit;
  - rotated 29.9 s ago gives RACE;
  - rotated exactly at the grace boundary;
  - rotated after grace gives REUSE.
- **refreshExpiry:** capped at the session's absolute expiry.
- **verifyCsrf:**
  - valid token;
  - token from another session;
  - missing header on POST;
  - GET skips the check;
  - Origin mismatch;
  - `Sec-Fetch-Site: cross-site`;
  - `Sec-Fetch-Site: none` allowed.
- **evaluatePrincipal:**
  - missing session;
  - revoked session;
  - `sub` mismatch;
  - expired absolute limit;
  - happy path returns a frozen object.
- **policy:**
  - full role-by-action matrix snapshot;
  - `mustChangePassword` blocks everything except the allowlist;
  - GRADUATED student denied the default student actions;
  - SUSPENDED sponsor denied the default sponsor actions but allowed read actions;
  - `listAllowedActions` for each role.
- **tenant scope:**
  - SCA gets their own school;
  - SCA asking for another school gets `SCOPE_MISMATCH`;
  - SA write without `schoolId` gets `SCHOOL_ID_REQUIRED`;
  - SA read without `schoolId` gets `all`;
  - STUDENT and SPONSOR denied;
  - a raw string cannot be passed where a `SchoolScope` is required (type test via `// @ts-expect-error`).
- **limiter:**
  - allows up to the limit;
  - locks at the limit;
  - unlocks after `lockMs`;
  - window resets;
  - keys are independent;
  - `Retry-After` rounds up;
  - map stays bounded after the sweep;
  - clock is injectable.
- **clientIp:**
  - `X-Real-IP` preferred;
  - a spoofed first XFF hop is ignored;
  - falls back to the last hop;
  - no headers.
- **getActivationGaps:**
  - one missing field at a time;
  - age of 4 and age of 26;
  - invalid phone;
  - inactive class;
  - class in another year;
  - class in another school;
  - complete record gives an empty list.
- **status-rules:** full allowed and denied transition matrix.
- **decideNisnClaim:**
  - no holder;
  - holder is self;
  - GRADUATED holder gives release and claim;
  - ACTIVE or INACTIVE holder gives a conflict.
- **school config:**
  - boundaries of `open < start ≤ close ≤ dayEnd < 1440`;
  - radius 49, 50, 1,000 and 1,001;
  - mask 0 and 128;
  - coordinates outside Indonesia;
  - bank fields must be all or none;
  - a patch that is invalid after merging.
- **import validation:**
  - missing required headers;
  - `activate=false` relaxes the header requirement;
  - numeric NISN zero-padded with a warning;
  - scientific notation;
  - date formats (Date cell, serial number, `DD/MM/YYYY`, `YYYY-MM-DD`, 31/02 invalid);
  - gender aliases;
  - duplicate NISN in the file flags every occurrence;
  - NIS already in the school;
  - NISN active elsewhere is an error;
  - NISN graduated elsewhere is a warning;
  - class name normalisation;
  - empty rows skipped;
  - 1,001 rows rejected.
- **normalizeIdPhone:** `08…`, `62…`, `+62…` and invalid input.
- **redactForAudit:** nested `passwordHash`, `refreshToken` and `secret` keys removed.
- **mapError:**
  - a `DomainError` becomes its status and code;
  - P2002 becomes 409;
  - an unknown error becomes 500 with no internal message.
- **withTx:**
  - retries P2034 up to 3 times;
  - gives up after that.

### Integration tests (real MariaDB 10.11, migrated and seeded)

- **Login:**
  - NISN login with Bearer returns tokens;
  - WEB login sets three cookies with the right `HttpOnly`, `SameSite` and `Path` and puts no token in the body;
  - email login never matches a STUDENT;
  - wrong password returns 401 and increments the counter;
  - the 9th failure returns 429 with `Retry-After`;
  - correct password on an inactive account returns 403 `ACCOUNT_INACTIVE`;
  - a DRAFT student returns 403;
  - WEB login with a foreign `Origin` returns 403.
- **Sessions:**
  - logging in on the same `deviceId` as another user revokes that user's session and clears its push token;
  - the per-role session cap evicts the oldest session.
- **Refresh:**
  - rotation works;
  - the old token reused after the grace window revokes the session, and its access token gets 401 immediately;
  - reuse within the grace window returns 409 and the session stays valid;
  - two concurrent refreshes: exactly one succeeds;
  - web refresh without `X-CSRF-Token` returns 403.
- **Logout and revocation:**
  - after logout the access token gets 401 before it expires;
  - `logout-all` works;
  - `DELETE` on another user's session returns 404.
- **Deactivation:**
  - deactivating a user gives 401 `ACCOUNT_INACTIVE` on the next request;
  - deactivating a school makes all its users get 401;
  - the last active SUPER_ADMIN cannot be deactivated (409);
  - SA cannot deactivate themselves.
- **Forced password change:**
  - with `mustChangePassword` set, other routes return 403 `PASSWORD_CHANGE_REQUIRED`;
  - `change-password` clears the flag, revokes the other sessions and keeps the current one;
  - a wrong current password returns 400, and the 6th attempt returns 429.
- **Admin reset:**
  - SCA can reset a student of their own school;
  - a student of another school returns 404;
  - a staff user returns 404;
  - SA can reset anyone except themselves;
  - the generated password logs in and is forced to change.
- **CSRF:**
  - cookie POST without the header returns 403;
  - with the header it succeeds;
  - Bearer POST without CSRF succeeds.
- **IDOR:**
  - school admin A doing GET, PATCH, activate, status change, delete or reset on a student of school B gets 404;
  - listing with `schoolId=B` returns 403;
  - creating a student with a `classId` from school B returns 404;
  - reading school B's audit logs is impossible.
- **Students:**
  - complete data with `activate=true` gives ACTIVE status, an active user and a forced password change;
  - incomplete data returns 422 and writes no rows;
  - `activate=false` gives DRAFT with `activeNisn` NULL;
  - NISN active elsewhere returns 409;
  - NISN graduated elsewhere is released and the old account's sessions are revoked;
  - two concurrent activations of the same NISN: one wins and the other gets 409;
  - DRAFT delete succeeds and ACTIVE delete returns 409;
  - clearing a required field on an ACTIVE student returns 422;
  - MOVED releases the NISN;
  - every status transition keeps `User.isActive` in step.
- **Import:**
  - a dry run writes nothing;
  - a valid commit creates N students whose credentials log in;
  - one bad row returns 422 and zero rows are written;
  - a conflict introduced between dry run and commit returns 409;
  - a file over 2 MiB returns 413;
  - a zip bomb is rejected;
  - CSV and XLSX give the same result;
  - `format=xlsx` returns a file with `no-store`;
  - the audit entry is written.
- **Schools:**
  - creation validates the city against the province;
  - SCA editing `/settings` succeeds;
  - SCA editing the geofence through `PATCH /schools/{id}` returns 403;
  - a merged-patch schedule violation returns 400.
- **Sponsors:**
  - create, approve, suspend and reinstate work as compare-and-set;
  - approving twice returns 409;
  - a SUSPENDED sponsor can log in, but mutating actions return 403 `SPONSOR_NOT_APPROVED`.
- **Platform settings:** out-of-bounds values return 400.
- **Audit:**
  - written in the same transaction (a forced rollback leaves no audit row);
  - no secrets inside `before` or `after`.
- **Push token:** moving a token between sessions on the same phone does not hit the unique constraint.
- **Cleanup job:**
  - idempotent through `JobRun`;
  - returns 403 without the secret;
  - returns 403 when called through a proxy with `X-Real-IP`.
- **Guard tests:**
  - route coverage: every `src/app/api/v1/**/route.ts` export is built with `apiRoute`, and its action is in `POLICY`;
  - tenant lint: no `findUnique({ where: { id` on school-scoped models under `src/lib/**`, apart from an allowlist.

### E2E tests (Playwright, API-level)

- A super admin provisions a school, then a school admin, then a sponsor, and approves the sponsor.
- The school admin imports students, and a student logs in with a generated password, is forced to change it, and then `/auth/me` works.
- A deactivated student is rejected on the next API call.

## 6. SCHEMA CHANGE REQUESTS

1. **Drop `User.tokenVersion`.** Each request already checks the `AuthSession` row (D4), and `revokeAllSessions` covers "log out everywhere". The field would be a second mechanism doing the same job.
2. **`Student.activeNisn` doc comment:** change to "= nisn for ACTIVE, INACTIVE and GRADUATED; NULL for DRAFT and MOVED; claimed at activation" (D14). No column change.
3. **`AuthSession`:** add `@@index([deviceId, revokedAt])` for the rule that revokes other sessions on the same device.
4. **`RefreshToken`:** add `@@index([rotatedAt])` and `@@index([expiresAt])` for the cleanup job.
5. **`User`:** add `@@index([role, isActive])`. The existing `[schoolId, role, isActive]` index cannot serve the super admin's user search by role or the check for the last super admin.
6. **`AuditLog`:** add `@@index([action, createdAt])` for filtering the audit list by action.
7. **CHECK constraint (init migration):** a STUDENT user must have `email IS NULL`. Email login excludes students anyway, and this removes any ambiguity.
8. **`ClientPlatform` usage note:** WEB means cookie transport; ANDROID and IOS mean Bearer. No change to the enum.

## 7. Questions for the client

1. **Siblings sharing one phone.** The design allows one active account per device, so a second account logging in logs the first one out, and check-ins from a shared device are flagged `SHARED_DEVICE`. Is that acceptable, or must one phone keep several students logged in at once?
2. **Initial passwords.** The design lets an admin type an initial password for a single student (for example, the birth date), but a bulk import always generates random passwords and produces a printable credential sheet. Is a generated password acceptable for imports, and may admins type weak initial passwords at all?
3. **Forgotten passwords.** The design has no self-service reset: students go to their school admin, and staff and sponsors go to the super admin. Is SMTP or WhatsApp OTP reset needed now?
4. **Session length.** The student app stays logged in for up to 180 days (30 days idle). Web dashboards log out after 12 hours idle, with a 7-day maximum. Are these acceptable?
5. **Bulk import scope.** Import is create-only and all-or-nothing (after a validation preview). Is bulk **update** of existing students by NISN (for example, class promotion at the start of a year) needed in this phase?
6. **Sponsor approval.** Since only the super admin creates sponsors, is the separate approval step wanted (it is useful if sponsors will later register themselves), or should creation approve the sponsor straight away?
7. **Graduated students.** They keep read-only login until the same NISN is activated at another school. Confirm.
