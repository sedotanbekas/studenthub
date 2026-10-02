import { test } from "node:test";
import assert from "node:assert/strict";
import { assertAdminQuota, assertHasPrimaryAdmin, assertManageableAdmin, MAX_SCHOOL_ADMINS } from "./rules";

const codeOf = (fn: () => void): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
};

test("assertManageableAdmin: admin tambahan boleh dikelola; admin utama dilindungi (hanya super admin)", () => {
  assert.equal(codeOf(() => assertManageableAdmin({ isPrimary: false })), null);
  assert.equal(codeOf(() => assertManageableAdmin({ isPrimary: true })), "PRIMARY_ADMIN_PROTECTED");
});

test("assertAdminQuota: batas akun admin per sekolah (aktif + nonaktif, akun tidak pernah dihapus)", () => {
  assert.equal(codeOf(() => assertAdminQuota(0)), null);
  assert.equal(codeOf(() => assertAdminQuota(MAX_SCHOOL_ADMINS - 1)), null);
  assert.equal(codeOf(() => assertAdminQuota(MAX_SCHOOL_ADMINS)), "SCHOOL_ADMIN_LIMIT");
});

test("assertHasPrimaryAdmin: admin tambahan hanya dibuat di sekolah yang sudah punya admin utama", () => {
  assert.equal(codeOf(() => assertHasPrimaryAdmin(true)), null);
  assert.equal(codeOf(() => assertHasPrimaryAdmin(false)), "PRIMARY_ADMIN_MISSING");
});
