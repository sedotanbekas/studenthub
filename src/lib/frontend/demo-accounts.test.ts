import assert from "node:assert/strict";
import test from "node:test";
import { demoAccountCounts, demoAccounts } from "./demo-accounts";

test("demoAccounts: filter sekolah, peran, dan cari nama/ID login seperti GET /platform/users", () => {
  assert.deepEqual(demoAccounts(new URLSearchParams("schoolId=sc1&role=SCHOOL_ADMIN")).map((a) => a.id), ["adm1", "adm2"]);
  assert.deepEqual(demoAccounts(new URLSearchParams("q=0091234504")).map((a) => a.id), ["st4"]);
  assert.deepEqual(demoAccounts(new URLSearchParams("role=SUPER_ADMIN")).map((a) => a.id), ["demo-sa"]);
});

test("demoAccountCounts: jumlah admin & siswa per sekolah contoh", () => {
  assert.deepEqual(demoAccountCounts("sc1"), { schoolAdmins: 2, students: 3 });
  assert.deepEqual(demoAccountCounts("tidak-ada"), { schoolAdmins: 0, students: 0 });
});
