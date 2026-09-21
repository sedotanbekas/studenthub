import { test } from "node:test";
import assert from "node:assert/strict";
import { chunk, overrideScopeViolation, planBulkInvoices, sortBulkStudents, type BulkStudent } from "./bulk-plan";

function student(id: string, overrides: Partial<BulkStudent> = {}): BulkStudent {
  return { id, name: `Siswa ${id}`, className: "VII-A", sppAmount: null, status: "ACTIVE", ...overrides };
}

const plan = (students: BulkStudent[], opts: { existing?: string[]; overrides?: Array<[string, number]> } = {}) =>
  planBulkInvoices({
    students,
    existing: new Set(opts.existing ?? []),
    defaultAmount: 150_000,
    overrides: new Map(opts.overrides ?? []),
  });

test("tagihan yang sudah ada (termasuk VOID) dilewati ALREADY_BILLED", () => {
  const result = plan([student("a"), student("b")], { existing: ["b"] });
  assert.deepEqual(result.rows, [{ studentId: "a", amount: 150_000 }]);
  assert.deepEqual(result.skipped, [{ studentId: "b", reason: "ALREADY_BILLED" }]);
});

test("sppAmount 0 -> EXEMPT; null -> default; override mengalahkan sppAmount", () => {
  const result = plan([student("a", { sppAmount: 0 }), student("b"), student("c", { sppAmount: 90_000 }), student("d", { sppAmount: 0 })], {
    overrides: [["c", 75_000], ["d", 120_000]],
  });
  assert.deepEqual(result.rows, [
    { studentId: "b", amount: 150_000 },
    { studentId: "c", amount: 75_000 },
    { studentId: "d", amount: 120_000 },
  ]);
  assert.deepEqual(result.skipped, [{ studentId: "a", reason: "EXEMPT" }]);
  assert.equal(result.totalAmount, 345_000);
});

test("override 0 = bebas; siswa tidak aktif & nominal di luar batas dilewati", () => {
  const result = plan([student("a"), student("b", { status: "INACTIVE" }), student("c", { sppAmount: 500 })], { overrides: [["a", 0]] });
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.skipped, [
    { studentId: "a", reason: "EXEMPT" },
    { studentId: "b", reason: "NOT_ACTIVE" },
    { studentId: "c", reason: "AMOUNT_INVALID" },
  ]);
  assert.equal(result.totalAmount, 0);
});

test("urutan stabil: kelas, nama, id (kelas kosong terakhir); input tidak dimutasi", () => {
  const input = Object.freeze([
    student("3", { className: "VIII-A", name: "Budi" }),
    student("2", { className: null, name: "Ani" }),
    student("1", { className: "VII-B", name: "Citra" }),
    student("4", { className: "VII-B", name: "Anto" }),
    student("0", { className: "VII-B", name: "Anto" }),
  ]);
  assert.deepEqual(sortBulkStudents(input).map((s) => s.id), ["0", "4", "1", "3", "2"]);
  assert.equal(input[0]?.id, "3");
  assert.deepEqual(plan([...input]).rows.map((r) => r.studentId), ["0", "4", "1", "3", "2"]);
});

test("overrideScopeViolation: override untuk siswa di luar cakupan ditolak", () => {
  assert.equal(overrideScopeViolation(["a", "b"], new Set(["a", "b", "c"])), null);
  const v = overrideScopeViolation(["a", "x"], new Set(["a"]));
  assert.equal(v?.code, "BULK_OVERRIDE_OUT_OF_SCOPE");
  assert.deepEqual(v?.details, { studentIds: ["x"] });
});

test("chunk membagi rata tanpa sisa kosong", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 200), []);
  assert.throws(() => chunk([1], 0), RangeError);
});
