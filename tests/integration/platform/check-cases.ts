/**
 * Kasus CHECK constraint untuk absensi, izin, SPP, klik iklan, rollup, dan ledger sponsor.
 * Setiap kasus menerima getter fixture karena fixture baru dibuat di before().
 */
import type { Prisma } from "@prisma/client";
import { toDbDate } from "../../../src/lib/time/zone";
import { prisma, uniq } from "../helpers/db";
import { createStoredFile } from "../helpers/factories";
import { INVOICE_AMOUNT, invoiceData, nextDate, type CheckFixture } from "./check-fixture";

export interface CheckCase {
  /** Nama constraint persis seperti di migration.sql. */
  readonly constraint: string;
  /** Setiap operasi WAJIB gagal hanya karena constraint ini. */
  readonly violations: readonly (() => Promise<unknown>)[];
  /** Operasi valid yang harus lolos (opsional). */
  readonly valid?: () => Promise<unknown>;
  /**
   * Pelanggaran yang SEHARUSNYA ditolak tetapi saat ini lolos karena celah definisi CHECK di migrasi.
   * Dijalankan sebagai test `todo` (tidak menggagalkan suite) sampai migrasi diperbaiki.
   */
  readonly knownGaps?: readonly { readonly description: string; readonly action: () => Promise<unknown> }[];
}

type GetFixture = () => CheckFixture;

const CLICK_DATE = toDbDate("2026-09-21");
const CHECKIN_AT = new Date("2026-09-21T00:05:00.000Z");
/** seq ledger untuk percobaan yang pasti gagal (tidak pernah tersimpan). */
const FAILING_LEDGER_SEQ = 99;

// ----------------------------------------------------------------------------- absensi & izin

function attendance(fx: CheckFixture, data: Partial<Prisma.AttendanceUncheckedCreateInput>) {
  return prisma.attendance.create({
    data: {
      schoolId: fx.school.id,
      studentId: fx.student.id,
      classId: fx.schoolClass.id,
      date: nextDate(),
      status: "HADIR",
      source: "ADMIN",
      ...data,
    },
  });
}

function checkIn(fx: CheckFixture, data: Partial<Prisma.AttendanceUncheckedCreateInput>) {
  return attendance(fx, { source: "CHECKIN", checkInAt: CHECKIN_AT, latitude: "-6.9147000", longitude: "107.6098000", ...data });
}

function leave(fx: CheckFixture, startDate: string, endDate: string) {
  return prisma.leaveRequest.create({
    data: {
      schoolId: fx.school.id,
      studentId: fx.student.id,
      type: "SAKIT",
      startDate: toDbDate(startDate),
      endDate: toDbDate(endDate),
      reason: "Sakit",
    },
  });
}

export function attendanceCases(get: GetFixture): readonly CheckCase[] {
  return [
    {
      constraint: "chk_attendance_checkin",
      violations: [() => checkIn(get(), {}), () => checkIn(get(), { latitude: null }), () => checkIn(get(), { checkInAt: null })],
      valid: async () => {
        const fx = get();
        const selfie = await createStoredFile(fx.studentUser.id, "ATTENDANCE_SELFIE", { schoolId: fx.school.id });
        return checkIn(fx, { selfieFileId: selfie.id });
      },
    },
    {
      constraint: "chk_attendance_auto_alpha",
      violations: [
        () => attendance(get(), { source: "AUTO_ALPHA", status: "HADIR" }),
        () => attendance(get(), { source: "AUTO_ALPHA", status: "IZIN" }),
      ],
      valid: () => attendance(get(), { source: "AUTO_ALPHA", status: "ALPHA" }),
    },
    {
      constraint: "chk_attendance_leave",
      violations: [
        () => attendance(get(), { source: "LEAVE", status: "IZIN" }),
        () => attendance(get(), { source: "LEAVE", status: "HADIR", leaveRequestId: get().leaveRequest.id }),
      ],
      valid: () => attendance(get(), { source: "LEAVE", status: "IZIN", leaveRequestId: get().leaveRequest.id }),
    },
    {
      constraint: "chk_attendance_late",
      violations: [
        () => attendance(get(), { status: "TERLAMBAT", lateMinutes: 0 }),
        () => attendance(get(), { status: "TERLAMBAT", lateMinutes: 721 }),
        () => attendance(get(), { status: "HADIR", lateMinutes: 5 }),
        () => attendance(get(), { status: "ALPHA", lateMinutes: 3 }),
        // Cabang TERLAMBAT memuat `lateMinutes` IS NOT NULL agar NULL tidak meloloskan CHECK.
        () => attendance(get(), { status: "TERLAMBAT" }),
      ],
      valid: async () => {
        await attendance(get(), { status: "TERLAMBAT", lateMinutes: 1 });
        await attendance(get(), { status: "TERLAMBAT", lateMinutes: 720 });
      },
    },
    {
      constraint: "chk_leave_range",
      violations: [() => leave(get(), "2026-09-22", "2026-09-21"), () => leave(get(), "2026-09-01", "2026-10-02")],
      valid: () => leave(get(), "2026-09-01", "2026-10-01"),
    },
  ];
}

// ----------------------------------------------------------------------------- SPP

async function submission(fx: CheckFixture, data: Partial<Prisma.PaymentSubmissionUncheckedCreateInput>) {
  const proof = await createStoredFile(fx.studentUser.id, "PAYMENT_PROOF", { schoolId: fx.school.id });
  return prisma.paymentSubmission.create({
    data: {
      schoolId: fx.school.id,
      invoiceId: fx.invoice.id,
      studentId: fx.student.id,
      amount: 50_000,
      transferDate: toDbDate("2026-09-21"),
      proofFileId: proof.id,
      status: "PENDING",
      pendingInvoiceId: fx.invoice.id,
      ...data,
    },
  });
}

function payment(fx: CheckFixture, amount: number) {
  return prisma.payment.create({
    data: {
      schoolId: fx.school.id,
      invoiceId: fx.invoice.id,
      receiptNo: uniq("K"),
      amount,
      method: "CASH",
      paidDate: toDbDate("2026-09-21"),
      recordedById: fx.admin.id,
    },
  });
}

const invoice = (fx: CheckFixture, overrides: Partial<Prisma.InvoiceUncheckedCreateInput>) =>
  prisma.invoice.create({ data: invoiceData(fx, overrides) });

function invoiceCases(get: GetFixture): readonly CheckCase[] {
  return [
    {
      constraint: "chk_invoice_amounts",
      violations: [
        () => invoice(get(), { amount: 0 }),
        () => invoice(get(), { amount: -1 }),
        () => invoice(get(), { periodMonth: 13 }),
        () => invoice(get(), { periodMonth: 0 }),
      ],
      valid: () => invoice(get(), { periodMonth: 3 }),
    },
    {
      constraint: "chk_invoice_status",
      violations: [
        () => invoice(get(), { status: "PAID", paidAmount: 0 }),
        () => invoice(get(), { status: "PAID", paidAmount: INVOICE_AMOUNT / 2 }),
        () => invoice(get(), { status: "PARTIAL", paidAmount: INVOICE_AMOUNT }),
        () => invoice(get(), { status: "PARTIAL", paidAmount: 0 }),
        () => invoice(get(), { status: "VOID", paidAmount: 1_000 }),
        () => invoice(get(), { status: "UNPAID", paidAmount: 1_000 }),
      ],
      valid: async () => {
        await invoice(get(), { periodMonth: 4, status: "PARTIAL", paidAmount: 40_000 });
        await invoice(get(), { periodMonth: 5, status: "PAID", paidAmount: INVOICE_AMOUNT });
        await invoice(get(), { periodMonth: 6, status: "VOID", paidAmount: 0 });
      },
    },
  ];
}

export function billingCases(get: GetFixture): readonly CheckCase[] {
  return [
    ...invoiceCases(get),
    {
      constraint: "chk_submission_amount",
      violations: [() => submission(get(), { amount: 0 }), () => submission(get(), { amount: -5 })],
      valid: () => submission(get(), { amount: 50_000 }),
    },
    {
      constraint: "chk_submission_pending",
      violations: [
        () => submission(get(), { invoiceId: get().otherInvoice.id, pendingInvoiceId: null }),
        () => submission(get(), { invoiceId: get().otherInvoice.id, status: "APPROVED", pendingInvoiceId: get().otherInvoice.id }),
        () => submission(get(), { invoiceId: get().otherInvoice.id, status: "REJECTED", pendingInvoiceId: get().otherInvoice.id }),
        () => submission(get(), { invoiceId: get().invoice.id, pendingInvoiceId: get().otherInvoice.id }),
      ],
      valid: async () => {
        await submission(get(), { invoiceId: get().otherInvoice.id, status: "APPROVED", pendingInvoiceId: null });
        await submission(get(), { invoiceId: get().otherInvoice.id, pendingInvoiceId: get().otherInvoice.id });
      },
    },
    {
      constraint: "chk_payment_amount",
      violations: [() => payment(get(), 0), () => payment(get(), -1)],
      valid: () => payment(get(), 1_000),
    },
    {
      constraint: "chk_document_counter",
      violations: [
        () => prisma.documentCounter.create({ data: { schoolId: get().school.id, kind: "RECEIPT", year: 2026, lastValue: -1 } }),
      ],
      valid: () => prisma.documentCounter.create({ data: { schoolId: get().school.id, kind: "INVOICE", year: 2026, lastValue: 0 } }),
    },
  ];
}

// ----------------------------------------------------------------------------- iklan & ledger

function click(fx: CheckFixture, data: Partial<Prisma.AdClickUncheckedCreateInput>) {
  return prisma.adClick.create({
    data: {
      adId: fx.ad.id,
      sponsorId: fx.sponsor.id,
      userId: fx.studentUser.id,
      schoolId: fx.school.id,
      provinceCode: "32",
      cityCode: "32.73",
      deviceType: "MOBILE",
      date: CLICK_DATE,
      billing: "DUPLICATE",
      ...data,
    },
  });
}

function dailyStat(fx: CheckFixture, data: Partial<Prisma.AdDailyStatUncheckedCreateInput>) {
  return prisma.adDailyStat.create({ data: { adId: fx.ad.id, sponsorId: fx.sponsor.id, date: nextDate(), ...data } });
}

function ledger(fx: CheckFixture, data: Partial<Prisma.SponsorLedgerEntryUncheckedCreateInput>) {
  return prisma.sponsorLedgerEntry.create({
    data: { sponsorId: fx.sponsor.id, seq: FAILING_LEDGER_SEQ, type: "ADJUSTMENT", amount: 1_000, balanceAfter: 1_000, ...data },
  });
}

export function adLedgerCases(get: GetFixture): readonly CheckCase[] {
  return [
    {
      constraint: "chk_ad_click_billing",
      violations: [
        () => click(get(), { billing: "CHARGED", chargeAmount: 500, billableDate: null }),
        () => click(get(), { billing: "CHARGED", chargeAmount: 0, billableDate: CLICK_DATE }),
        () => click(get(), { billing: "SUSPECT", chargeAmount: 500, billableDate: CLICK_DATE }),
        () => click(get(), { billing: "DUPLICATE", chargeAmount: -1 }),
      ],
      valid: async () => {
        await click(get(), { billing: "CHARGED", chargeAmount: 500, billableDate: CLICK_DATE });
        await click(get(), { billing: "SUSPECT", chargeAmount: 0 });
      },
    },
    {
      constraint: "chk_ad_daily_stat",
      violations: [
        () => dailyStat(get(), { impressions: -1 }),
        () => dailyStat(get(), { clicks: -1 }),
        () => dailyStat(get(), { uniqueClicks: -1 }),
        () => dailyStat(get(), { chargedClicks: -1 }),
        () => dailyStat(get(), { spend: -1 }),
      ],
      valid: () => dailyStat(get(), { impressions: 10, clicks: 2, uniqueClicks: 2, chargedClicks: 1, spend: 500 }),
    },
    {
      constraint: "chk_ledger_amount",
      violations: [
        () => ledger(get(), { amount: 0, balanceAfter: 0 }),
        () => ledger(get(), { amount: 100, balanceAfter: -1 }),
        () => ledger(get(), { type: "TOPUP", amount: 100_000, balanceAfter: 100_000 }),
        () => ledger(get(), { type: "CLICK_CHARGE", amount: -500, balanceAfter: 0 }),
        () => ledger(get(), { type: "CLICK_CHARGE", amount: 500, balanceAfter: 500 }),
      ],
      // Entri valid + saldo cache disamakan dalam satu transaksi (invarian balance == balanceAfter terakhir).
      valid: () =>
        prisma.$transaction([
          ledger(get(), { seq: 1, type: "ADJUSTMENT", amount: 1_000, balanceAfter: 1_000, note: "Test CHECK" }),
          prisma.sponsor.update({ where: { id: get().sponsor.id }, data: { balance: 1_000 } }),
        ]),
    },
  ];
}
