import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { GET as platformAuditRoute } from "@/app/api/v1/platform/audit-logs/route";
import { GET as schoolAuditRoute } from "@/app/api/v1/school/audit-logs/route";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { disconnect, prisma, uniq } from "../helpers/db";
import { callRoute, type Envelope } from "../helpers/request";
import { setupTwoSchools, type TwoSchools } from "../schools/fixtures";

type AuditRow = {
  id: string;
  createdAt: string;
  actor: { id: string; name: string; role: string } | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
};

let fx: TwoSchools;
let action = "";
const T0 = new Date("2026-09-01T00:00:00.000Z");
const minutes = (n: number): Date => new Date(T0.getTime() + n * 60_000);

/** Enam entri dengan aksi unik: A (3), B (2), platform tanpa sekolah (1). */
before(async () => {
  resetAllLimiters();
  fx = await setupTwoSchools();
  action = uniq("uji.audit").slice(0, 40);
  const row = (schoolId: string | null, entityId: string, at: Date, actorId: string | null) => ({
    action,
    entityType: "Uji",
    entityId,
    schoolId,
    actorId,
    actorRole: actorId ? ("SUPER_ADMIN" as const) : null,
    before: { name: "lama", passwordHash: "rahasia-tidak-boleh-bocor" },
    after: { name: "baru" },
    ipAddress: "10.0.0.1",
    createdAt: at,
  });
  await prisma.auditLog.createMany({
    data: [
      row(fx.schoolA.id, "a-1", minutes(1), fx.sa.user.id),
      row(fx.schoolA.id, "a-2", minutes(2), fx.adminA.user.id),
      row(fx.schoolA.id, "a-3", minutes(3), null),
      row(fx.schoolB.id, "b-1", minutes(4), fx.adminB.user.id),
      row(fx.schoolB.id, "b-2", minutes(5), fx.sa.user.id),
      row(null, "p-1", minutes(6), fx.sa.user.id),
    ],
  });
});
after(disconnect);

const platform = (token: string, qs: string) =>
  callRoute<Envelope<AuditRow[]>>(platformAuditRoute, { method: "GET", url: `/api/v1/platform/audit-logs?action=${encodeURIComponent(action)}${qs}`, bearer: token });
const school = (token: string, qs: string) =>
  callRoute<Envelope<AuditRow[]>>(schoolAuditRoute, { method: "GET", url: `/api/v1/school/audit-logs?action=${encodeURIComponent(action)}${qs}`, bearer: token });
const ids = (res: { body: Envelope<AuditRow[]> | null }): string[] => res.body?.data.map((r) => r.entityId) ?? [];

describe("GET /platform/audit-logs", () => {
  test("terbaru dulu, aktor terisi, rahasia sudah diredaksi, meta paginasi", async () => {
    const res = await platform(fx.sa.token, "");
    assert.equal(res.status, 200);
    assert.deepEqual(ids(res), ["p-1", "b-2", "b-1", "a-3", "a-2", "a-1"]);
    assert.deepEqual(res.body?.meta, { total: 6, page: 1, limit: 20, totalPages: 1 });
    const first = res.body?.data[0];
    assert.equal(first?.actor?.id, fx.sa.user.id);
    assert.equal(first?.actor?.role, "SUPER_ADMIN");
    assert.equal(first?.ipAddress, "10.0.0.1");
    assert.equal(res.body?.data.find((r) => r.entityId === "a-3")?.actor, null);
    assert.doesNotMatch(JSON.stringify(res.body), /rahasia-tidak-boleh-bocor/);
  });

  test("filter sekolah, pelaku, entitas, rentang waktu, halaman", async () => {
    assert.deepEqual(ids(await platform(fx.sa.token, `&schoolId=${fx.schoolB.id}`)), ["b-2", "b-1"]);
    assert.deepEqual(ids(await platform(fx.sa.token, `&actorId=${fx.adminA.user.id}`)), ["a-2"]);
    assert.deepEqual(ids(await platform(fx.sa.token, "&entityType=Uji&entityId=a-1")), ["a-1"]);
    const range = `&from=${encodeURIComponent(minutes(2).toISOString())}&to=${encodeURIComponent("2026-09-01T07:04:00+07:00")}`;
    assert.deepEqual(ids(await platform(fx.sa.token, range)), ["b-1", "a-3", "a-2"]);
    const page2 = await platform(fx.sa.token, "&limit=4&page=2");
    assert.deepEqual(ids(page2), ["a-2", "a-1"]);
    assert.equal((page2.body?.meta as { totalPages: number }).totalPages, 2);
  });

  test("query tidak valid -> 400", async () => {
    for (const qs of ["&limit=101", "&from=kemarin", `&from=${minutes(5).toISOString()}&to=${minutes(1).toISOString()}`]) {
      const res = await platform(fx.sa.token, qs);
      assert.equal(res.status, 400, qs);
    }
  });

  test("selain super admin -> 403", async () => {
    for (const token of [fx.adminA.token, fx.student.token, fx.sponsor.token]) assert.equal((await platform(token, "")).status, 403);
  });
});

describe("GET /school/audit-logs", () => {
  test("admin sekolah hanya melihat sekolahnya sendiri", async () => {
    const res = await school(fx.adminA.token, "");
    assert.equal(res.status, 200);
    assert.deepEqual(ids(res), ["a-3", "a-2", "a-1"]);
    assert.deepEqual(ids(await school(fx.adminB.token, "")), ["b-2", "b-1"]);
    assert.deepEqual(ids(await school(fx.adminA.token, "&entityId=b-1")), []);
    assert.doesNotMatch(JSON.stringify(res.body), /rahasia-tidak-boleh-bocor/);
  });

  test("IDOR: admin A meminta sekolah B -> 403 SCOPE_MISMATCH", async () => {
    const res = await school(fx.adminA.token, `&schoolId=${fx.schoolB.id}`);
    assert.equal(res.status, 403);
    assert.equal(res.body?.error?.code, "SCOPE_MISMATCH");
  });

  test("super admin: wajib schoolId (400), sekolah tak dikenal 404, sekolah B hanya milik B", async () => {
    const missing = await school(fx.sa.token, "");
    assert.equal(missing.status, 400);
    assert.equal(missing.body?.error?.code, "SCHOOL_ID_REQUIRED");
    assert.equal((await school(fx.sa.token, "&schoolId=tidak-ada")).status, 404);
    assert.deepEqual(ids(await school(fx.sa.token, `&schoolId=${fx.schoolB.id}`)), ["b-2", "b-1"]);
  });

  test("siswa & sponsor -> 403", async () => {
    assert.equal((await school(fx.student.token, "")).status, 403);
    assert.equal((await school(fx.sponsor.token, "")).status, 403);
  });
});
