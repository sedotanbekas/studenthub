import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkTestDatabaseUrl, commandLine, isFlagSet, migrateCommand, shouldResetDatabase } from "./db-guard";

describe("checkTestDatabaseUrl", () => {
  test("menerima database lokal berakhiran _test", () => {
    const result = checkTestDatabaseUrl("mysql://studenthub:rahasia@127.0.0.1:3307/studenthub_test");
    assert.deepEqual(result, { ok: true, database: "studenthub_test", host: "127.0.0.1:3307" });
  });

  test("menerima database CI berakhiran _test dan mengabaikan query string", () => {
    const result = checkTestDatabaseUrl("mysql://u:p@127.0.0.1:3306/studenthub_ci_test?connectTimeout=5000");
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.database, "studenthub_ci_test");
  });

  test("menolak DATABASE_URL kosong atau tidak ada", () => {
    assert.equal(checkTestDatabaseUrl(undefined).ok, false);
    assert.equal(checkTestDatabaseUrl("").ok, false);
    assert.equal(checkTestDatabaseUrl("   ").ok, false);
  });

  test("menolak URL yang tidak bisa di-parse", () => {
    const result = checkTestDatabaseUrl("bukan url");
    assert.equal(result.ok, false);
  });

  test("menolak skema selain mysql://", () => {
    const result = checkTestDatabaseUrl("postgresql://u:p@localhost:5432/studenthub_test");
    assert.equal(result.ok, false);
  });

  test("menolak database dev, staging, produksi, dan nama yang hanya memuat _test di tengah", () => {
    for (const name of ["studenthub", "studenthub_dev", "studenthub_staging", "studenthub_test_backup", "test", "_test", "studenthub_TEST"]) {
      const result = checkTestDatabaseUrl(`mysql://u:p@127.0.0.1:3307/${name}`);
      assert.equal(result.ok, false, `nama ${name} seharusnya ditolak`);
    }
  });

  test("menolak URL tanpa nama database", () => {
    assert.equal(checkTestDatabaseUrl("mysql://u:p@127.0.0.1:3307").ok, false);
    assert.equal(checkTestDatabaseUrl("mysql://u:p@127.0.0.1:3307/").ok, false);
  });

  test("menolak nama database berisi karakter di luar [A-Za-z0-9_$]", () => {
    assert.equal(checkTestDatabaseUrl("mysql://u:p@127.0.0.1:3307/a%2Fb_test").ok, false);
    assert.equal(checkTestDatabaseUrl("mysql://u:p@127.0.0.1:3307/db/x_test").ok, false);
  });

  test("alasan penolakan tidak pernah memuat password", () => {
    const result = checkTestDatabaseUrl("mysql://studenthub:SangatRahasia123@127.0.0.1:3307/studenthub_dev");
    assert.equal(result.ok, false);
    assert.ok(!result.ok && !result.reason.includes("SangatRahasia123"));
    assert.ok(!result.ok && result.reason.includes("studenthub_dev"));
  });
});

describe("isFlagSet", () => {
  test("hanya nilai yang terisi dan bukan false/0 dianggap aktif", () => {
    assert.equal(isFlagSet(undefined), false);
    assert.equal(isFlagSet(""), false);
    assert.equal(isFlagSet("false"), false);
    assert.equal(isFlagSet("0"), false);
    assert.equal(isFlagSet("true"), true);
    assert.equal(isFlagSet("1"), true);
    assert.equal(isFlagSet("TRUE"), true);
  });
});

describe("shouldResetDatabase", () => {
  test("lokal tanpa flag: reset", () => {
    assert.equal(shouldResetDatabase({}), true);
  });

  test("CI: tidak reset (database CI selalu baru)", () => {
    assert.equal(shouldResetDatabase({ CI: "true" }), false);
  });

  test("TEST_DB_NO_RESET=1: tidak reset, hanya migrate deploy", () => {
    assert.equal(shouldResetDatabase({ TEST_DB_NO_RESET: "1" }), false);
    assert.equal(shouldResetDatabase({ TEST_DB_NO_RESET: "0" }), true);
  });
});

describe("migrateCommand", () => {
  test("reset: reset penuh tanpa prompt", () => {
    const cmd = migrateCommand(true);
    assert.deepEqual(cmd.args, ["prisma", "migrate", "reset", "--force"]);
    assert.equal(commandLine(cmd), "npx prisma migrate reset --force");
  });

  test("tanpa reset: hanya migrate deploy", () => {
    const cmd = migrateCommand(false);
    assert.deepEqual(cmd.args, ["prisma", "migrate", "deploy"]);
    assert.equal(commandLine(cmd), "npx prisma migrate deploy");
  });
});
