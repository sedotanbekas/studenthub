import { test } from "node:test";
import assert from "node:assert/strict";
import { dueJobs, hourKey, runKeyFor } from "./schedule";
import { JOB_NAMES } from "./types";

const at = (iso: string): Date => new Date(iso);

test("dueJobs 18:59Z: tiga job, maintenance-daily belum jatuh tempo", () => {
  assert.deepEqual(dueJobs(at("2026-09-21T18:59:00Z")), [
    { name: "push-dispatch", runKey: null },
    { name: "attendance-auto-alpha", runKey: null },
    { name: "files-orphan-cleanup", runKey: "2026-09-21T18" },
  ]);
});

test("dueJobs 19:00Z: maintenance-daily jatuh tempo dengan kunci tanggal WIB (02:00 WIB esok hari)", () => {
  assert.deepEqual(dueJobs(at("2026-09-21T19:00:00Z")), [
    { name: "push-dispatch", runKey: null },
    { name: "attendance-auto-alpha", runKey: null },
    { name: "files-orphan-cleanup", runKey: "2026-09-21T19" },
    { name: "maintenance-daily", runKey: "2026-09-22" },
  ]);
});

test("dueJobs 23:59Z: maintenance-daily tetap jatuh tempo dengan kunci WIB yang sama (retry/idempoten)", () => {
  const daily = dueJobs(at("2026-09-21T23:59:59Z")).find((job) => job.name === "maintenance-daily");
  assert.deepEqual(daily, { name: "maintenance-daily", runKey: "2026-09-22" });
});

test("dueJobs 00:00Z..18:59Z: maintenance-daily tidak jatuh tempo", () => {
  for (const iso of ["2026-09-22T00:00:00Z", "2026-09-22T07:30:00Z", "2026-09-22T17:00:00Z", "2026-09-22T18:59:59Z"]) {
    const names = dueJobs(at(iso)).map((job) => job.name);
    assert.equal(names.includes("maintenance-daily"), false, iso);
  }
});

test("dueJobs pada :00, :05, :07 dalam satu jam memakai kunci jam UTC yang sama", () => {
  const keys = ["2026-09-21T03:00:00Z", "2026-09-21T03:05:00Z", "2026-09-21T03:07:30Z"].map(
    (iso) => dueJobs(at(iso)).find((job) => job.name === "files-orphan-cleanup")?.runKey,
  );
  assert.deepEqual(keys, ["2026-09-21T03", "2026-09-21T03", "2026-09-21T03"]);
});

test("dueJobs: push-dispatch & attendance-auto-alpha jatuh tempo di setiap tick tanpa runKey", () => {
  for (const iso of ["2026-01-01T00:00:00Z", "2026-06-15T12:34:00Z", "2026-12-31T23:59:00Z"]) {
    const queue = dueJobs(at(iso)).filter((job) => job.runKey === null).map((job) => job.name);
    assert.deepEqual(queue, ["push-dispatch", "attendance-auto-alpha"], iso);
  }
});

test("dueJobs mengembalikan array baru setiap panggilan (tidak berbagi state)", () => {
  const now = at("2026-09-21T19:00:00Z");
  assert.notEqual(dueJobs(now), dueJobs(now));
});

test("hourKey = 'YYYY-MM-DDTHH' UTC dan muat di kolom runKey (≤ 32)", () => {
  assert.equal(hourKey(at("2026-09-21T00:00:00Z")), "2026-09-21T00");
  assert.equal(hourKey(at("2026-12-31T23:59:59.999Z")), "2026-12-31T23");
  assert.ok(hourKey(at("2026-09-21T10:00:00Z")).length <= 32);
});

test("runKeyFor: kunci yang sama dengan penjadwal untuk setiap job (dipakai eksekusi manual)", () => {
  const now = at("2026-09-21T10:15:00Z");
  assert.equal(runKeyFor("push-dispatch", now), null);
  assert.equal(runKeyFor("attendance-auto-alpha", now), null);
  assert.equal(runKeyFor("files-orphan-cleanup", now), "2026-09-21T10");
  assert.equal(runKeyFor("maintenance-daily", now), "2026-09-21");
  assert.equal(runKeyFor("maintenance-daily", at("2026-09-21T17:00:00Z")), "2026-09-22");
});

test("setiap JobName punya jadwal (tidak ada job yatim)", () => {
  const scheduled = new Set(dueJobs(at("2026-09-21T19:00:00Z")).map((job) => job.name));
  assert.deepEqual([...scheduled].sort(), [...JOB_NAMES].sort());
});
