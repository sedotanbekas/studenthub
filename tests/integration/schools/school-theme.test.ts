import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { DELETE as deleteTheme, GET as getTheme, PUT as putThemeRoute } from "@/app/api/v1/school/theme/route";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { DEFAULT_THEME } from "@/lib/schools/theme-rules";
import { me } from "../auth/helpers";
import { disconnect, prisma } from "../helpers/db";
import { createSchool, createSchoolAdmin } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { actor, setupTwoSchools, type Actor, type TwoSchools } from "./fixtures";

type Theme = {
  preset: string | null;
  primaryColor: string;
  secondaryColor: string;
  bannerColor: string;
  animationColor: string;
  logoColor: string;
  isCustom: boolean;
  updatedAt: string | null;
};

const DEFAULT_RESPONSE: Theme = { preset: "nusantara", ...DEFAULT_THEME, isCustom: false, updatedAt: null };
/** Palet "madani" dengan huruf besar + spasi: server wajib menormalkan ke `#rrggbb` huruf kecil. */
const MADANI_INPUT = {
  preset: "madani",
  primaryColor: "#15803D",
  secondaryColor: " #A16207 ",
  bannerColor: "#14532d",
  animationColor: "#4ADE80",
  logoColor: "#15803d",
};
const MADANI_STORED = { preset: "madani", primaryColor: "#15803d", secondaryColor: "#a16207", bannerColor: "#14532d", animationColor: "#4ade80", logoColor: "#15803d" };
const NULL_THEME = { preset: null, primaryColor: null, secondaryColor: null, bannerColor: null, animationColor: null, logoColor: null };
/** Kolom tema School yang masih kosong (termasuk themeUpdatedAt). */
const NULL_ROW = {
  themePreset: null,
  themePrimaryColor: null,
  themeSecondaryColor: null,
  themeBannerColor: null,
  themeAnimationColor: null,
  themeLogoColor: null,
  themeUpdatedAt: null,
};
/** Tema kustom tanpa preset, warna bebas (tanpa aturan kontras: web menurunkan warna teks sendiri). */
const CUSTOM_INPUT = { primaryColor: "#fde68a", secondaryColor: "#ffffff", bannerColor: "#fef9c3", animationColor: "#000000", logoColor: "#ff00ff" };

let fx: TwoSchools;

before(async () => {
  resetAllLimiters();
  fx = await setupTwoSchools();
});
after(disconnect);

const url = (query: string) => `/api/v1/school/theme${query}`;
const readTheme = (token: string, query = "") => callRoute<Envelope<Theme>>(getTheme, { method: "GET", url: url(query), bearer: token });
const putTheme = (token: string, json: unknown, query = "") =>
  callRoute<Envelope<Theme>>(putThemeRoute, { method: "PUT", url: url(query), bearer: token, json });
const resetTheme = (token: string, query = "") => callRoute<Envelope<Theme>>(deleteTheme, { method: "DELETE", url: url(query), bearer: token });

async function freshSchoolAdmin(): Promise<{ schoolId: string; admin: Actor }> {
  const school = await createSchool();
  return { schoolId: school.id, admin: await actor(await createSchoolAdmin(school.id)) };
}

const themeRow = (schoolId: string) =>
  prisma.school.findUniqueOrThrow({
    where: { id: schoolId },
    select: { themePreset: true, themePrimaryColor: true, themeSecondaryColor: true, themeBannerColor: true, themeAnimationColor: true, themeLogoColor: true, themeUpdatedAt: true },
  });
const auditCount = (schoolId: string, action: string) => prisma.auditLog.count({ where: { entityId: schoolId, action } });

describe("GET /school/theme", () => {
  test("sekolah baru: tema bawaan, bukan kustom, preset nusantara", async () => {
    const { admin } = await freshSchoolAdmin();
    const res = await readTheme(admin.token);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body?.data, DEFAULT_RESPONSE);
  });
});

describe("PUT /school/theme", () => {
  test("admin menyimpan palet (dinormalkan huruf kecil) + audit school.theme_update dari kolom kosong", async () => {
    const res = await putTheme(fx.adminA.token, MADANI_INPUT);
    assert.equal(res.status, 200, JSON.stringify(res.body?.error));
    const { updatedAt, ...rest } = res.body!.data;
    assert.deepEqual(rest, { ...MADANI_STORED, isCustom: true });
    assert.ok(updatedAt && !Number.isNaN(Date.parse(updatedAt)));

    const row = await themeRow(fx.schoolA.id);
    assert.equal(row.themePrimaryColor, "#15803d");
    assert.equal(row.themeSecondaryColor, "#a16207");
    assert.equal(row.themePreset, "madani");
    assert.equal(row.themeUpdatedAt?.toISOString(), updatedAt);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: fx.schoolA.id, action: "school.theme_update" } });
    assert.equal(audit.actorId, fx.adminA.user.id);
    assert.equal(audit.schoolId, fx.schoolA.id);
    assert.equal(audit.entityType, "School");
    assert.deepEqual(audit.before, NULL_THEME);
    assert.deepEqual(audit.after, MADANI_STORED);
  });

  test("siswa sekolah itu menerima tema baru lewat /auth/me", async () => {
    const res = await me(fx.student.token);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body?.data.school?.theme, (await readTheme(fx.adminA.token)).body?.data);
    assert.equal(res.body?.data.school?.theme.primaryColor, "#15803d");
  });

  test("PUT identik (termasuk beda huruf besar/kecil) -> 200 tanpa audit kedua, updatedAt tetap", async () => {
    const before = await themeRow(fx.schoolA.id);
    const res = await putTheme(fx.adminA.token, { ...MADANI_STORED, primaryColor: "#15803D" });
    assert.equal(res.status, 200);
    assert.equal(await auditCount(fx.schoolA.id, "school.theme_update"), 1);
    assert.deepEqual((await themeRow(fx.schoolA.id)).themeUpdatedAt, before.themeUpdatedAt);
  });

  test("warna bebas tanpa preset (tanpa aturan kontras) -> tersimpan, preset null", async () => {
    const { schoolId, admin } = await freshSchoolAdmin();
    const res = await putTheme(admin.token, CUSTOM_INPUT);
    assert.equal(res.status, 200, JSON.stringify(res.body?.error));
    assert.equal(res.body?.data.preset, null);
    assert.equal(res.body?.data.isCustom, true);
    assert.equal(res.body?.data.primaryColor, "#fde68a");
    const explicitNull = await putTheme(admin.token, { ...CUSTOM_INPUT, preset: null });
    assert.equal(explicitNull.status, 200);
    assert.equal(await auditCount(schoolId, "school.theme_update"), 1, "preset null = tanpa preset -> no-op");
  });

  test("hex tidak valid, kunci kurang/berlebih, preset tak dikenal -> 400 VALIDATION_FAILED, data tetap", async () => {
    const { schoolId, admin } = await freshSchoolAdmin();
    const { logoColor: _omitted, ...missingLogo } = CUSTOM_INPUT;
    const bodies: unknown[] = [
      { ...CUSTOM_INPUT, primaryColor: "#abc" },
      { ...CUSTOM_INPUT, primaryColor: "red" },
      { ...CUSTOM_INPUT, bannerColor: "#GGGGGG" },
      { ...CUSTOM_INPUT, logoColor: "1d4ed8" },
      { ...CUSTOM_INPUT, animationColor: "#1d4ed8ff" },
      { ...CUSTOM_INPUT, secondaryColor: null },
      missingLogo,
      { ...CUSTOM_INPUT, fontFamily: "Inter" },
      { ...CUSTOM_INPUT, preset: "pelangi" },
      {},
    ];
    for (const body of bodies) {
      const res = await putTheme(admin.token, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body?.error?.code, "VALIDATION_FAILED");
    }
    assert.deepEqual(await themeRow(schoolId), NULL_ROW);
    assert.equal(await auditCount(schoolId, "school.theme_update"), 0);
  });
});

describe("DELETE /school/theme", () => {
  test("reset ke tema bawaan + audit school.theme_reset; reset kedua tanpa audit", async () => {
    const { schoolId, admin } = await freshSchoolAdmin();
    assert.equal((await putTheme(admin.token, MADANI_INPUT)).status, 200);

    const res = await resetTheme(admin.token);
    assert.equal(res.status, 200, JSON.stringify(res.body?.error));
    const { updatedAt, ...rest } = res.body!.data;
    const { updatedAt: _ignored, ...defaults } = DEFAULT_RESPONSE;
    assert.deepEqual(rest, defaults);
    assert.ok(updatedAt, "updatedAt diisi waktu reset");

    const row = await themeRow(schoolId);
    assert.deepEqual({ ...row, themeUpdatedAt: null }, NULL_ROW);
    assert.equal(row.themeUpdatedAt?.toISOString(), updatedAt);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: schoolId, action: "school.theme_reset" } });
    assert.equal(audit.actorId, admin.user.id);
    assert.equal(audit.schoolId, schoolId);
    assert.deepEqual(audit.before, MADANI_STORED);
    assert.deepEqual(audit.after, NULL_THEME);

    const again = await resetTheme(admin.token);
    assert.equal(again.status, 200);
    assert.equal(again.body?.data.updatedAt, updatedAt);
    assert.equal(await auditCount(schoolId, "school.theme_reset"), 1);
  });

  test("reset sekolah yang belum pernah diubah -> no-op (tanpa audit, updatedAt tetap null)", async () => {
    const { schoolId, admin } = await freshSchoolAdmin();
    const res = await resetTheme(admin.token);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body?.data, DEFAULT_RESPONSE);
    assert.equal(await auditCount(schoolId, "school.theme_reset"), 0);
  });
});

describe("scope & peran /school/theme", () => {
  test("admin A ke sekolah B -> 403 SCOPE_MISMATCH (GET/PUT/DELETE), sekolah B tidak berubah", async () => {
    const query = `?schoolId=${fx.schoolB.id}`;
    for (const res of [await readTheme(fx.adminA.token, query), await putTheme(fx.adminA.token, CUSTOM_INPUT, query), await resetTheme(fx.adminA.token, query)]) {
      assert.equal(res.status, 403);
      assert.equal(res.body?.error?.code, "SCOPE_MISMATCH");
    }
    assert.deepEqual(await themeRow(fx.schoolB.id), NULL_ROW);
  });

  test("super admin: tanpa schoolId 400, sekolah tak dikenal 404, dengan schoolId 200", async () => {
    for (const res of [await readTheme(fx.sa.token), await putTheme(fx.sa.token, CUSTOM_INPUT), await resetTheme(fx.sa.token)]) {
      assert.equal(res.status, 400);
      assert.equal(res.body?.error?.code, "SCHOOL_ID_REQUIRED");
    }
    const unknown = "?schoolId=tidak-ada";
    for (const res of [await readTheme(fx.sa.token, unknown), await putTheme(fx.sa.token, CUSTOM_INPUT, unknown), await resetTheme(fx.sa.token, unknown)]) {
      assert.equal(res.status, 404);
    }
    const read = await readTheme(fx.sa.token, `?schoolId=${fx.schoolB.id}`);
    assert.equal(read.status, 200);
    assert.deepEqual(read.body?.data, DEFAULT_RESPONSE);

    const { schoolId } = await freshSchoolAdmin();
    const put = await putTheme(fx.sa.token, CUSTOM_INPUT, `?schoolId=${schoolId}`);
    assert.equal(put.status, 200);
    assert.equal((await themeRow(schoolId)).themeLogoColor, "#ff00ff");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: schoolId, action: "school.theme_update" } });
    assert.equal(audit.actorId, fx.sa.user.id);
  });

  test("siswa & sponsor -> 403 pada GET/PUT/DELETE", async () => {
    for (const who of [fx.student, fx.sponsor]) {
      assert.equal((await readTheme(who.token)).status, 403);
      assert.equal((await putTheme(who.token, CUSTOM_INPUT)).status, 403);
      assert.equal((await resetTheme(who.token)).status, 403);
    }
    assert.equal((await themeRow(fx.schoolA.id)).themePreset, "madani", "tema sekolah A tidak tersentuh");
  });
});
