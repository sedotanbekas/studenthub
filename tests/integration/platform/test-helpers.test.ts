/**
 * Kontrak helper integration test (tests/integration/helpers/*) yang dipakai semua domain.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { verify } from "@node-rs/bcrypt";
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "../../../src/lib/env";
import { disconnect, prisma, uniq } from "../helpers/db";
import {
  DEFAULT_TEST_PASSWORD,
  createAcademicYearWithTerm,
  createClass,
  createSchool,
  createSchoolAdmin,
  createSponsor,
  createStoredFile,
  createStudent,
  createSuperAdmin,
  uniqNisn,
} from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { createTempStorage } from "../helpers/storage";

after(disconnect);

async function passwordMatches(userId: string, password: string): Promise<boolean> {
  const row = await prisma.user.findUniqueOrThrow({ where: { id: userId }, omit: { passwordHash: false } });
  return verify(password, row.passwordHash);
}

describe("helpers/db", () => {
  test("uniq menghasilkan string pendek yang unik", () => {
    const values = Array.from({ length: 2_000 }, () => uniq("x"));
    assert.equal(new Set(values).size, values.length);
    for (const value of values) assert.ok(value.length <= 18 && value.startsWith("x-"), value);
  });
});

describe("helpers/factories", () => {
  test("uniqNisn selalu 10 digit tanpa awalan 0", () => {
    for (let i = 0; i < 200; i += 1) assert.match(uniqNisn(), /^[1-9]\d{9}$/);
  });

  test("createSchool: default Jawa Barat/Kota Bandung, WIB; timezone & wilayah dapat diubah", async () => {
    const school = await createSchool();
    assert.equal(school.provinceCode, "32");
    assert.equal(school.cityCode, "32.73");
    assert.equal(school.timezone, "WIB");
    const wit = await createSchool({ timezone: "WIT", provinceCode: "91", cityCode: "91.71" });
    assert.equal(wit.timezone, "WIT");
    assert.equal(wit.cityCode, "91.71");
  });

  test("createAcademicYearWithTerm: aktif (default) mengisi School.activeTermId; active:false tidak", async () => {
    const school = await createSchool();
    const { academicYear, term } = await createAcademicYearWithTerm(school.id);
    assert.equal(term.academicYearId, academicYear.id);
    assert.equal((await prisma.school.findUniqueOrThrow({ where: { id: school.id } })).activeTermId, term.id);

    const other = await createSchool();
    await createAcademicYearWithTerm(other.id, { active: false });
    assert.equal((await prisma.school.findUniqueOrThrow({ where: { id: other.id } })).activeTermId, null);
  });

  test("createClass + createStudent ACTIVE: email NULL, activeNisn = nisn, activatedAt terisi, password default", async () => {
    const school = await createSchool();
    const { academicYear } = await createAcademicYearWithTerm(school.id);
    const schoolClass = await createClass(school.id, academicYear.id);
    const { user, student } = await createStudent(school.id, { classId: schoolClass.id });
    assert.equal(user.role, "STUDENT");
    assert.equal(user.email, null);
    assert.equal(user.schoolId, school.id);
    assert.equal(student.status, "ACTIVE");
    assert.equal(student.activeNisn, student.nisn);
    assert.equal(student.currentClassId, schoolClass.id);
    assert.ok(student.activatedAt && student.activatedAt.getTime() < Date.now());
    assert.equal("passwordHash" in user, false, "passwordHash di-omit global");
    assert.equal(await passwordMatches(user.id, DEFAULT_TEST_PASSWORD), true);
  });

  test("createStudent DRAFT/MOVED tanpa activeNisn; GRADUATED/INACTIVE memegang NISN", async () => {
    const school = await createSchool();
    const draft = await createStudent(school.id, { status: "DRAFT" });
    assert.equal(draft.student.activeNisn, null);
    assert.equal(draft.student.activatedAt, null);
    const moved = await createStudent(school.id, { status: "MOVED" });
    assert.equal(moved.student.activeNisn, null);
    for (const status of ["INACTIVE", "GRADUATED"] as const) {
      const { student } = await createStudent(school.id, { status });
      assert.equal(student.activeNisn, student.nisn);
    }
  });

  test("createSuperAdmin, createSchoolAdmin: cakupan peran benar dan password kustom", async () => {
    const school = await createSchool();
    const superAdmin = await createSuperAdmin();
    assert.equal(superAdmin.role, "SUPER_ADMIN");
    assert.equal(superAdmin.schoolId, null);
    const admin = await createSchoolAdmin(school.id, { password: "LainLagi456", mustChangePassword: true });
    assert.equal(admin.role, "SCHOOL_ADMIN");
    assert.equal(admin.schoolId, school.id);
    assert.equal(admin.mustChangePassword, true);
    assert.equal(await passwordMatches(admin.id, "LainLagi456"), true);
  });

  test("createSponsor: default APPROVED saldo 0 + akun SPONSOR; status dapat diubah", async () => {
    const { sponsor, user } = await createSponsor();
    assert.equal(sponsor.status, "APPROVED");
    assert.equal(sponsor.balance, 0);
    assert.equal(user.role, "SPONSOR");
    assert.equal(user.sponsorId, sponsor.id);
    assert.equal(user.email, sponsor.contactEmail);
    const pending = await createSponsor({ status: "PENDING" });
    assert.equal(pending.sponsor.status, "PENDING");
  });

  test("createStoredFile: baris metadata privat dengan sha256 hex 64", async () => {
    const admin = await createSuperAdmin();
    const file = await createStoredFile(admin.id, "PAYMENT_PROOF");
    assert.match(file.storageKey, /^private\//);
    assert.match(file.sha256, /^[0-9a-f]{64}$/);
  });
});

describe("helpers/request callRoute", () => {
  type Echo = { method: string; path: string; auth: string | null; params: unknown; json: unknown; contentType: string | null };

  async function echo(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
    const contentType = request.headers.get("content-type");
    const json = contentType?.startsWith("application/json") ? await request.json() : null;
    const data: Echo = {
      method: request.method,
      path: request.nextUrl.pathname + request.nextUrl.search,
      auth: request.headers.get("authorization"),
      params: await context.params,
      json,
      contentType,
    };
    return NextResponse.json({ success: true, data, error: null, meta: null }, { status: 201, headers: { "x-test": "1" } });
  }

  test("meneruskan method, path+query, bearer, params, dan body JSON", async () => {
    const res = await callRoute<Envelope<Echo>>(echo, {
      method: "POST",
      url: "/api/v1/things/abc?x=1",
      bearer: "token-123",
      params: { id: "abc" },
      json: { name: "Budi" },
    });
    assert.equal(res.status, 201);
    assert.equal(res.headers.get("x-test"), "1");
    assert.deepEqual(res.body?.data, {
      method: "POST",
      path: "/api/v1/things/abc?x=1",
      auth: "Bearer token-123",
      params: { id: "abc" },
      json: { name: "Budi" },
      contentType: "application/json",
    });
  });

  test("params default {} dan handler tanpa argumen kedua diterima", async () => {
    const res = await callRoute<Envelope<Echo>>(echo, { method: "GET", url: "/x" });
    assert.deepEqual(res.body?.data.params, {});
    const simple = await callRoute((request: Request) => Response.json({ ok: request.method }), { method: "DELETE", url: "/y" });
    assert.deepEqual(simple.body, { ok: "DELETE" });
  });

  test("formData dikirim multipart dengan boundary", async () => {
    const form = new FormData();
    form.set("note", "halo");
    form.set("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "a.png");
    const handler = async (request: NextRequest): Promise<Response> => {
      const received = await request.formData();
      const file = received.get("file");
      return Response.json({ note: received.get("note"), size: file instanceof Blob ? file.size : -1 });
    };
    const res = await callRoute<{ note: string; size: number }>(handler, { method: "POST", url: "/upload", formData: form });
    assert.deepEqual(res.body, { note: "halo", size: 3 });
  });

  test("respons non-JSON: body null dan Response asli belum dibaca", async () => {
    const handler = (): Response => new Response(new Uint8Array([9, 8, 7]), { headers: { "content-type": "image/webp" } });
    const res = await callRoute(handler, { method: "GET", url: "/files/1" });
    assert.equal(res.body, null);
    assert.deepEqual([...new Uint8Array(await res.response.arrayBuffer())], [9, 8, 7]);
  });

  test("json dan formData bersamaan ditolak", async () => {
    await assert.rejects(
      callRoute(() => new Response(null), { method: "POST", url: "/x", json: {}, formData: new FormData() }),
      /tidak boleh dipakai bersamaan/,
    );
  });
});

describe("helpers/storage", () => {
  test("createTempStorage memasang STORAGE_ROOT (getEnv ikut) lalu cleanup menghapus & memulihkan", async () => {
    const previous = process.env.STORAGE_ROOT;
    const storage = await createTempStorage();
    assert.equal(process.env.STORAGE_ROOT, storage.root);
    assert.equal(getEnv().STORAGE_ROOT, storage.root);
    await writeFile(join(storage.root, "a.txt"), "x");
    await storage.cleanup();
    await storage.cleanup();
    assert.equal(existsSync(storage.root), false);
    assert.equal(process.env.STORAGE_ROOT, previous);
  });
});
