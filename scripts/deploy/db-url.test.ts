import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDatabaseUrl, toMysqlClientCnf, type DatabaseConnection } from "./db-url";

test("parseDatabaseUrl mengurai URL standar", () => {
  const conn = parseDatabaseUrl("mysql://studenthub:abc123@127.0.0.1:3306/studenthub");
  assert.deepEqual(conn, {
    host: "127.0.0.1",
    port: 3306,
    user: "studenthub",
    password: "abc123",
    database: "studenthub",
  });
});

test("parseDatabaseUrl memakai port 3306 bila port tidak disebut", () => {
  const conn = parseDatabaseUrl("mysql://app:pw@db.internal/studenthub_staging");
  assert.equal(conn.port, 3306);
  assert.equal(conn.host, "db.internal");
  assert.equal(conn.database, "studenthub_staging");
});

test("parseDatabaseUrl men-decode user dan password ter-URL-encode", () => {
  const conn = parseDatabaseUrl("mysql://app%40x:p%40ss%3Aw%2Fo%23rd%25@127.0.0.1:3307/studenthub_dev");
  assert.equal(conn.user, "app@x");
  assert.equal(conn.password, "p@ss:w/o#rd%");
  assert.equal(conn.port, 3307);
});

test("parseDatabaseUrl mengabaikan query string", () => {
  const conn = parseDatabaseUrl("mysql://u:p@127.0.0.1:3306/studenthub?connection_limit=5&timezone=Z");
  assert.equal(conn.database, "studenthub");
});

test("parseDatabaseUrl melepas kurung siku host IPv6", () => {
  const conn = parseDatabaseUrl("mysql://u:p@[::1]:3306/studenthub");
  assert.equal(conn.host, "::1");
});

test("parseDatabaseUrl mengizinkan password kosong", () => {
  const conn = parseDatabaseUrl("mysql://root@127.0.0.1/studenthub_dev");
  assert.equal(conn.user, "root");
  assert.equal(conn.password, "");
});

test("parseDatabaseUrl menolak nilai yang bukan URL", () => {
  assert.throws(() => parseDatabaseUrl("bukan url"), /bukan URL yang sah/);
  assert.throws(() => parseDatabaseUrl(""), /bukan URL yang sah/);
});

test("parseDatabaseUrl menolak skema selain mysql://", () => {
  assert.throws(() => parseDatabaseUrl("postgres://u:p@h:5432/db"), /mysql:\/\//);
  assert.throws(() => parseDatabaseUrl("mariadb://u:p@h:3306/db"), /mysql:\/\//);
});

test("parseDatabaseUrl menolak URL tanpa host", () => {
  assert.throws(() => parseDatabaseUrl("mysql:///studenthub"), /host/);
  assert.throws(() => parseDatabaseUrl("mysql:u:p@h/db"), /host/);
});

test("parseDatabaseUrl menolak URL tanpa user", () => {
  assert.throws(() => parseDatabaseUrl("mysql://127.0.0.1:3306/studenthub"), /user/);
});

test("parseDatabaseUrl menolak URL tanpa nama database", () => {
  assert.throws(() => parseDatabaseUrl("mysql://u:p@h:3306/"), /nama database/);
  assert.throws(() => parseDatabaseUrl("mysql://u:p@h:3306"), /nama database/);
});

test("parseDatabaseUrl menolak nama database yang tidak aman", () => {
  assert.throws(() => parseDatabaseUrl("mysql://u:p@h/stud%2Fenthub"), /nama database/);
  assert.throws(() => parseDatabaseUrl("mysql://u:p@h/-opsi"), /nama database/);
  assert.throws(() => parseDatabaseUrl("mysql://u:p@h/nama%20spasi"), /nama database/);
  assert.throws(() => parseDatabaseUrl(`mysql://u:p@h/${"a".repeat(65)}`), /nama database/);
});

test("parseDatabaseUrl menolak karakter kontrol pada kredensial (cegah injeksi baris cnf)", () => {
  assert.throws(() => parseDatabaseUrl("mysql://u:a%0Ab@h/studenthub"), /karakter kontrol/);
  assert.throws(() => parseDatabaseUrl("mysql://u%0D:p@h/studenthub"), /karakter kontrol/);
});

test("parseDatabaseUrl menolak percent-encoding yang cacat", () => {
  assert.throws(() => parseDatabaseUrl("mysql://u:%E0%A4%A@h/studenthub"), /encoding/);
});

test("pesan error parseDatabaseUrl tidak pernah memuat password", () => {
  const secret = "rahasiaSangatPanjang123";
  const cases = [
    `mysql://u:${secret}@h/nama%20spasi`,
    `mysql://u:${secret}@h/`,
    `postgres://u:${secret}@h/db`,
    `mysql://u:${secret}%0A@h/db`,
  ];
  for (const value of cases) {
    assert.throws(
      () => parseDatabaseUrl(value),
      (error: unknown) => error instanceof Error && !error.message.includes(secret),
    );
  }
});

const SAMPLE: DatabaseConnection = {
  host: "127.0.0.1",
  port: 3306,
  user: "studenthub",
  password: "abc123",
  database: "studenthub",
};

test("toMysqlClientCnf menghasilkan blok [client] tanpa nama database", () => {
  assert.equal(
    toMysqlClientCnf(SAMPLE),
    '[client]\nhost="127.0.0.1"\nport=3306\nuser="studenthub"\npassword="abc123"\n',
  );
});

test("toMysqlClientCnf meng-escape backslash dan kutip ganda", () => {
  const cnf = toMysqlClientCnf({ ...SAMPLE, user: 'a"b', password: 'x\\y"z' });
  assert.match(cnf, /^user="a\\"b"$/m);
  assert.match(cnf, /^password="x\\\\y\\"z"$/m);
});

test("toMysqlClientCnf tidak mengubah objek masukan", () => {
  const input = Object.freeze({ ...SAMPLE });
  toMysqlClientCnf(input);
  assert.deepEqual(input, SAMPLE);
});
