/**
 * Regresi konkurensi domain siswa:
 * A) snapshot basi — kunci diambil PALING AWAL lalu data dibaca ulang; persist compare-and-set status.
 *    Dibuktikan dengan urutan deterministik (transaksi pemblokir) bahkan di REPEATABLE READ.
 * B) write-skew kelas — aktivasi/penempatan/impor ke kelas mengambil kunci `class:<id>` dan memeriksa
 *    ulang kelas aktif di bawah kunci (penonaktifan kelas memakai kunci yang sama).
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { POST as activate } from "@/app/api/v1/school/students/[id]/activate/route";
import { PATCH as patchOne } from "@/app/api/v1/school/students/[id]/route";
import { POST as importRoute } from "@/app/api/v1/school/students/import/route";
import { POST as create } from "@/app/api/v1/school/students/route";
import type { ActionContext } from "@/lib/auth/principal";
import { makePrincipal } from "@/lib/auth/test-principal";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { classLockKey } from "@/lib/lock-keys";
import { applyStatusChange } from "@/lib/students/lifecycle-service";
import { applyUpdate } from "@/lib/students/update-service";
import { resolveSchoolScope, type SchoolScope } from "@/lib/tenant/scope";
import { lockKey, withTx } from "@/lib/tx";
import { disconnect, prisma, uniq, type Tx } from "../helpers/db";
import { createClass, createStudent } from "../helpers/factories";
import { callRoute, type RouteResult } from "../helpers/request";
import { IMPORT_HEADER, callMultipart, completeStudentBody, createSchoolFixture, csvBlob, importForm, importRow, studentUrl, type SchoolFixture } from "./helpers";

type ErrorBody = { error: { code: string; details: unknown } | null };

let a: SchoolFixture;

before(async () => {
  a = await createSchoolFixture();
});
beforeEach(() => resetAllLimiters());
after(disconnect);

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Waktu tunggu agar operasi yang diuji pasti sudah menunggu kunci milik transaksi pemblokir. */
const BLOCK_MS = 400;
const REPEATABLE_READ = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, retries: 0 };

interface HeldTx {
  readonly ready: Promise<void>;
  readonly release: () => void;
  readonly done: Promise<void>;
}

/** Transaksi pemblokir: jalankan `work`, lalu tahan kuncinya (belum commit) sampai `release()`. */
function holdTx(work: (tx: Tx) => Promise<void>): HeldTx {
  let release: () => void = () => undefined;
  let markReady: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const ready = new Promise<void>((resolve) => (markReady = resolve));
  const done = prisma.$transaction(
    async (tx) => {
      await work(tx as Tx);
      markReady();
      await gate;
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
  return { ready, release: () => release(), done };
}

/** Jalankan `operation` saat `blocker` memegang kunci; lepas setelah `blockMs`; kembalikan hasil operasi. */
async function raceBehind<T>(blocker: HeldTx, operation: () => Promise<T>, blockMs: number = BLOCK_MS): Promise<T> {
  await blocker.ready;
  const pending = operation();
  await pause(blockMs);
  blocker.release();
  await blocker.done;
  return pending;
}

function adminContext(fx: SchoolFixture): { ctx: ActionContext; scope: SchoolScope } {
  const principal = makePrincipal({ userId: fx.admin.id, role: "SCHOOL_ADMIN", schoolId: fx.school.id });
  const ctx: ActionContext = { principal, now: new Date(), requestId: uniq("uji-konkuren"), ip: null, userAgent: null, defer: () => undefined };
  return { ctx, scope: resolveSchoolScope(principal) };
}

const errorOf = (promise: Promise<unknown>): Promise<{ status?: number; code?: string } | null> =>
  promise.then(
    () => null,
    (error: { status?: number; code?: string }) => error,
  );

const lockStudent = (tx: Tx, id: string) => tx.$queryRaw`SELECT \`id\` FROM \`Student\` WHERE \`id\` = ${id} FOR UPDATE`;

const findRow = (id: string) => prisma.student.findFirst({ where: { id, schoolId: a.school.id } });

describe("A) snapshot basi: kunci dulu, baca kemudian (REPEATABLE READ dipaksa)", () => {
  test("aktivasi di belakang PATCH yang mengosongkan kelas & alamat -> ditolak, siswa tetap DRAFT", async () => {
    const { student } = await createStudent(a.school.id, { status: "DRAFT", classId: a.klass.id });
    const { ctx, scope } = adminContext(a);
    const blocker = holdTx(async (tx) => {
      await lockStudent(tx, student.id);
      await tx.student.update({ where: { id: student.id }, data: { currentClassId: null, address: null } });
    });
    const request = { scope, id: student.id, input: { to: "ACTIVE" as const, confirmReleaseGraduatedNisn: false }, classHint: a.klass.id };
    const error = await raceBehind(blocker, () => errorOf(withTx((tx) => applyStatusChange(tx, request, ctx), REPEATABLE_READ)));
    assert.ok(error, "aktivasi harus ditolak");
    assert.ok([409, 422].includes(error.status ?? 0), JSON.stringify(error));
    const row = await findRow(student.id);
    assert.equal(row?.status, "DRAFT");
    assert.equal(row?.activeNisn, null);
  });

  test("PATCH di belakang aktivasi -> PATCH ditolak (kekurangan baru / status berubah), baris tetap lengkap", async () => {
    const { student } = await createStudent(a.school.id, { status: "DRAFT", classId: a.klass.id });
    const { ctx, scope } = adminContext(a);
    const blocker = holdTx(async (tx) => {
      await lockStudent(tx, student.id);
      await tx.student.update({ where: { id: student.id }, data: { status: "ACTIVE", activeNisn: student.nisn, activatedAt: new Date() } });
    });
    const error = await raceBehind(blocker, () =>
      errorOf(withTx((tx) => applyUpdate(tx, scope, student.id, { currentClassId: null, address: null }, ctx), REPEATABLE_READ)),
    );
    assert.ok(error, "PATCH harus ditolak");
    assert.ok([409, 422].includes(error.status ?? 0), JSON.stringify(error));
    const row = await findRow(student.id);
    assert.equal(row?.status, "ACTIVE");
    assert.equal(row?.currentClassId, a.klass.id);
    assert.ok(row?.address);
  });

  test("route: /activate & PATCH {currentClassId:null, address:null} bersamaan -> tanpa 500, tepat satu berhasil, tak pernah ACTIVE berkekurangan", async () => {
    for (let i = 0; i < 6; i += 1) {
      const { student } = await createStudent(a.school.id, { status: "DRAFT", classId: a.klass.id });
      const results = await Promise.all([
        callRoute<ErrorBody>(activate, { method: "POST", url: studentUrl(`/${student.id}/activate`), params: { id: student.id }, bearer: a.adminToken, json: {} }),
        callRoute<ErrorBody>(patchOne, { method: "PATCH", url: studentUrl(`/${student.id}`), params: { id: student.id }, bearer: a.adminToken, json: { currentClassId: null, address: null } }),
      ]);
      const summary = JSON.stringify(results.map((r) => [r.status, r.body?.error?.code]));
      assert.ok(results.every((r) => r.status < 500), summary);
      assert.equal(results.filter((r) => r.status === 200).length, 1, summary);
      const row = await findRow(student.id);
      if (row?.status === "ACTIVE") {
        assert.ok(row.currentClassId, summary);
        assert.ok(row.address, summary);
      }
    }
  });
});

describe("B) kelas dinonaktifkan bersamaan: kunci class:<id> + cek ulang di bawah kunci", () => {
  async function deactivatingClass() {
    const klass = await createClass(a.school.id, a.academicYearId, { name: uniq("VIII") });
    const blocker = holdTx(async (tx) => {
      await lockKey(tx, classLockKey(klass.id));
      await tx.schoolClass.update({ where: { id: klass.id }, data: { isActive: false } });
    });
    return { klass, blocker };
  }

  const expect422 = (res: RouteResult<ErrorBody>, pattern: RegExp) => {
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.match(JSON.stringify(res.body?.error), pattern);
  };

  test("aktivasi ke kelas yang sedang dinonaktifkan -> 422 (CLASS_INACTIVE), tetap DRAFT", async () => {
    const { klass, blocker } = await deactivatingClass();
    const { student } = await createStudent(a.school.id, { status: "DRAFT", classId: klass.id });
    const res = await raceBehind(blocker, () =>
      callRoute<ErrorBody>(activate, { method: "POST", url: studentUrl(`/${student.id}/activate`), params: { id: student.id }, bearer: a.adminToken, json: {} }),
    );
    expect422(res, /CLASS_INACTIVE/);
    assert.equal((await findRow(student.id))?.status, "DRAFT");
  });

  test("buat siswa ke kelas yang sedang dinonaktifkan -> 422 CLASS_INACTIVE, tidak ada yang dibuat", async () => {
    const { klass, blocker } = await deactivatingClass();
    const body = completeStudentBody(klass.id);
    const res = await raceBehind(blocker, () => callRoute<ErrorBody>(create, { method: "POST", url: studentUrl(""), bearer: a.adminToken, json: body }));
    expect422(res, /CLASS_INACTIVE/);
    assert.equal(await prisma.student.count({ where: { schoolId: a.school.id, nisn: String(body.nisn) } }), 0);
  });

  test("PATCH pindah ke kelas yang sedang dinonaktifkan -> 422 CLASS_INACTIVE", async () => {
    const { klass, blocker } = await deactivatingClass();
    const { student } = await createStudent(a.school.id, { classId: a.klass.id });
    const res = await raceBehind(blocker, () =>
      callRoute<ErrorBody>(patchOne, { method: "PATCH", url: studentUrl(`/${student.id}`), params: { id: student.id }, bearer: a.adminToken, json: { currentClassId: klass.id } }),
    );
    expect422(res, /CLASS_INACTIVE/);
    assert.equal((await findRow(student.id))?.currentClassId, a.klass.id);
  });

  test("commit impor ke kelas yang sedang dinonaktifkan -> 422 CLASS_INACTIVE, nol baris tertulis", async () => {
    const { klass, blocker } = await deactivatingClass();
    const rows = [IMPORT_HEADER, importRow(klass.name), importRow(a.klass.name)];
    const before = await prisma.student.count({ where: { schoolId: a.school.id } });
    const form = importForm(csvBlob(rows), "siswa.csv", { dryRun: "false" });
    const res = await raceBehind(blocker, () => callMultipart<ErrorBody>(importRoute, { url: "/api/v1/school/students/import", form, bearer: a.adminToken }), 1500);
    expect422(res, /CLASS_INACTIVE/);
    assert.equal(await prisma.student.count({ where: { schoolId: a.school.id } }), before);
  });
});
