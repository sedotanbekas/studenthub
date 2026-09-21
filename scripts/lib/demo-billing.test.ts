import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDueDate } from "../../src/lib/billing/period-rules";
import { DEMO_SCHOOLS, DEMO_STUDENTS_PER_SCHOOL } from "./demo-data";
import { DEMO_BILLING_PERIODS, demoCashPlan, demoDueDate, demoInvoiceOutcome, demoIssueDate, type DemoInvoiceOutcome } from "./demo-billing-plan";

const tally = (periodIndex: number): Record<string, number> =>
  Array.from({ length: DEMO_STUDENTS_PER_SCHOOL }, (_, i) => demoInvoiceOutcome(i, periodIndex)).reduce<Record<string, number>>(
    (acc, outcome) => ({ ...acc, [outcome]: (acc[outcome] ?? 0) + 1 }),
    {},
  );

test("periode demo: Juli–September 2026; tarif SMP 250.000 & SMA 350.000", () => {
  assert.deepEqual(DEMO_BILLING_PERIODS, [
    { periodYear: 2026, periodMonth: 7 },
    { periodYear: 2026, periodMonth: 8 },
    { periodYear: 2026, periodMonth: 9 },
  ]);
  assert.deepEqual(DEMO_SCHOOLS.map((s) => s.sppAmount), [250_000, 350_000]);
});

test("demoInvoiceOutcome: campuran lunas / sebagian / belum bayar + tepat satu menunggu verifikasi", () => {
  assert.deepEqual(tally(0), { PAID: 12, PARTIAL: 3 });
  assert.deepEqual(tally(1), { PAID: 5, PARTIAL: 5, UNPAID: 5 });
  assert.deepEqual(tally(2), { PENDING_TRANSFER: 1, PAID: 4, UNPAID: 10 });
  assert.equal(demoInvoiceOutcome(0, 2), "PENDING_TRANSFER");
});

test("demoIssueDate & demoDueDate: Juli terbit awal tahun ajaran; jatuh tempo lolos aturan SPP dan setelah terbit", () => {
  assert.equal(demoIssueDate(DEMO_BILLING_PERIODS[0]!), "2026-07-13");
  assert.equal(demoIssueDate(DEMO_BILLING_PERIODS[1]!), "2026-08-01");
  assert.equal(demoDueDate(DEMO_BILLING_PERIODS[0]!), "2026-07-23");
  assert.equal(demoDueDate(DEMO_BILLING_PERIODS[1]!), "2026-08-10");
  assert.equal(demoDueDate(DEMO_BILLING_PERIODS[2]!), "2026-09-10");
  for (const period of DEMO_BILLING_PERIODS) {
    const due = demoDueDate(period);
    assert.equal(validateDueDate(due, period.periodYear, period.periodMonth), null);
    assert.ok(due > demoIssueDate(period));
  }
});

test("demoCashPlan: LUNAS = penuh, SEBAGIAN = setengah dibulatkan ribuan, lainnya tanpa pembayaran tunai", () => {
  const july = DEMO_BILLING_PERIODS[0]!;
  const paid = demoCashPlan("PAID", 250_000, july, 3);
  assert.deepEqual(paid && { amount: paid.amount, date: paid.date }, { amount: 250_000, date: "2026-07-17" });
  const partial = demoCashPlan("PARTIAL", 350_000, july, 4);
  assert.deepEqual(partial && { amount: partial.amount, date: partial.date }, { amount: 175_000, date: "2026-07-26" });
  assert.equal(demoCashPlan("PARTIAL", 250_000, july, 4)?.amount, 125_000);
  for (const outcome of ["UNPAID", "PENDING_TRANSFER"] as const satisfies readonly DemoInvoiceOutcome[]) {
    assert.equal(demoCashPlan(outcome, 250_000, july, 0), null);
  }
});

test("demoCashPlan: tanggal bayar di bulan periode, setelah tanggal terbit, jam kerja", () => {
  for (const [p, period] of DEMO_BILLING_PERIODS.entries()) {
    for (let i = 0; i < DEMO_STUDENTS_PER_SCHOOL; i += 1) {
      const plan = demoCashPlan(demoInvoiceOutcome(i, p), 250_000, period, i);
      if (!plan) continue;
      assert.ok(plan.date > demoIssueDate(period), `${plan.date}`);
      assert.equal(plan.date.slice(0, 7), `${period.periodYear}-${String(period.periodMonth).padStart(2, "0")}`);
      assert.ok(plan.minuteOfDay >= 7 * 60 && plan.minuteOfDay < 15 * 60, String(plan.minuteOfDay));
    }
  }
});
