import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { POST as deactivateRoute } from "@/app/api/v1/platform/users/[id]/deactivate/route";
import { POST as resetRoute } from "@/app/api/v1/platform/users/[id]/reset-password/route";
import { POST as revokeRoute } from "@/app/api/v1/platform/users/[id]/revoke-sessions/route";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { userLockKey } from "@/lib/lock-keys";
import { lockKey } from "@/lib/tx";
import { APP_LOCK_SQL, holdTransaction, waitUntilBlocked } from "../auth/helpers";
import { disconnect, prisma } from "../helpers/db";
import { createSchoolAdmin } from "../helpers/factories";
import { callRoute, type AnyRouteHandler, type Envelope } from "../helpers/request";
import { setupTwoSchools, type TwoSchools } from "../schools/fixtures";

/**
 * Mutasi akun oleh super admin (reset kata sandi, nonaktifkan, cabut sesi) mengambil kunci user yang
 * sama dengan login: login yang sedang membuat sesi selesai dulu, lalu sesinya ikut dicabut.
 */
let fx: TwoSchools;

before(async () => {
  resetAllLimiters();
  fx = await setupTwoSchools();
});
after(disconnect);

const DAY_MS = 86_400_000;
const post = (handler: AnyRouteHandler, action: string, id: string, json?: unknown) =>
  callRoute<Envelope<unknown>>(handler, { method: "POST", url: `/api/v1/platform/users/${id}/${action}`, bearer: fx.sa.token, params: { id }, json });

const ACTIONS: ReadonlyArray<readonly [string, (id: string) => ReturnType<typeof post>]> = [
  ["reset kata sandi", (id) => post(resetRoute, "reset-password", id, {})],
  ["nonaktifkan", (id) => post(deactivateRoute, "deactivate", id, { reason: "Uji kunci user" })],
  ["cabut sesi", (id) => post(revokeRoute, "revoke-sessions", id)],
];

for (const [name, run] of ACTIONS) {
  test(`${name} menunggu login yang memegang kunci user: sesi yang dibuat login itu ikut dicabut`, async () => {
    const admin = await createSchoolAdmin(fx.schoolA.id);
    let sessionId = "";
    // Meniru transaksi login: kunci user diambil PERTAMA, sesi baru ditulis belakangan (sebelum commit).
    const login = holdTransaction(
      (tx) => lockKey(tx, userLockKey(admin.id)),
      async (tx) => {
        const now = new Date();
        const session = await tx.authSession.create({
          data: { userId: admin.id, platform: "WEB", lastUsedAt: now, expiresAt: new Date(now.getTime() + DAY_MS) },
          select: { id: true },
        });
        sessionId = session.id;
      },
    );
    await login.ready;
    const pending = run(admin.id);
    const state = await waitUntilBlocked(pending, [APP_LOCK_SQL]);
    await login.commit();
    assert.equal(state, "blocked", "mutasi akun harus menunggu kunci user");
    const res = await pending;
    assert.equal(res.status, 200, JSON.stringify(res.body?.error));
    const session = await prisma.authSession.findUniqueOrThrow({ where: { id: sessionId }, select: { revokedAt: true } });
    assert.ok(session.revokedAt, "sesi dari login yang bersamaan harus ikut dicabut");
  });
}
