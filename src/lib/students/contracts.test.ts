import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_CONTRACTS } from "@/lib/openapi/registry";
import { studentsContracts } from "./contracts";

test("hanya ada SATU route pembuat siswa di seluruh API (siklus hidup tunggal)", () => {
  const creators = ALL_CONTRACTS.filter((c) => c.method === "POST" && /\/students(?:\/bulk)?$/.test(c.path));
  assert.deepEqual(creators.map((c) => c.id), ["createSchoolStudent"]);
});

test("setiap kontrak siswa memakai aksi POLICY domain students", () => {
  for (const c of studentsContracts) assert.match(String(c.action), /^students\./, c.id);
});

test("setiap route /school/students* menerima ?schoolId= untuk super admin", () => {
  for (const c of studentsContracts.filter((k) => k.path.startsWith("/api/v1/school/"))) {
    const shape = (c.query as { shape?: Record<string, unknown> } | undefined)?.shape ?? {};
    assert.ok("schoolId" in shape, c.id);
  }
});

test("reset kata sandi & impor dibatasi rate limit per pengguna; impor berupa multipart", () => {
  const byId = new Map(studentsContracts.map((c) => [c.id, c]));
  assert.deepEqual(byId.get("resetSchoolStudentPassword")?.rateLimit, { limiter: "ADMIN_RESET", key: "user" });
  assert.deepEqual(byId.get("importSchoolStudents")?.rateLimit, { limiter: "IMPORT", key: "user" });
  assert.equal(byId.get("importSchoolStudents")?.bodyType, "multipart");
});
