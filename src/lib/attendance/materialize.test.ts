import { test } from "node:test";
import assert from "node:assert/strict";
import { isAppError } from "@/lib/http/errors";
import { isAttendanceDuplicate, withMaterializeRetry } from "./materialize";

const adapterDuplicate = (index: string) => ({ code: "P2002", meta: { driverAdapterError: { cause: { constraint: { index } } } } });

test("isAttendanceDuplicate: hanya P2002 pada kunci unik (studentId, date)", () => {
  assert.equal(isAttendanceDuplicate(adapterDuplicate("Attendance_studentId_date_key")), true);
  assert.equal(isAttendanceDuplicate({ code: "P2002", meta: { target: ["studentId", "date"] } }), true);
  assert.equal(isAttendanceDuplicate(adapterDuplicate("Attendance_selfieFileId_key")), false);
  assert.equal(isAttendanceDuplicate({ code: "P2034" }), false);
  assert.equal(isAttendanceDuplicate(new Error("lain")), false);
  assert.equal(isAttendanceDuplicate(null), false);
});

test("withMaterializeRetry mengulang setelah bentrok lalu berhasil", async () => {
  let calls = 0;
  const result = await withMaterializeRetry(async () => {
    calls += 1;
    if (calls === 1) throw adapterDuplicate("Attendance_studentId_date_key");
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("withMaterializeRetry: bentrok terus -> 409 CONFLICT_RETRY setelah 3 percobaan", async () => {
  let calls = 0;
  await assert.rejects(
    withMaterializeRetry(async () => {
      calls += 1;
      throw adapterDuplicate("Attendance_studentId_date_key");
    }),
    (err: unknown) => isAppError(err) && err.status === 409 && err.code === "CONFLICT_RETRY",
  );
  assert.equal(calls, 3);
});

test("withMaterializeRetry tidak mengulang error lain", async () => {
  let calls = 0;
  await assert.rejects(
    withMaterializeRetry(async () => {
      calls += 1;
      throw new Error("gagal lain");
    }),
    /gagal lain/,
  );
  assert.equal(calls, 1);
});
