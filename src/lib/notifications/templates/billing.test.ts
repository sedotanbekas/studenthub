import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bulkInvoiceIssuedNotification,
  invoiceIssuedNotification,
  invoiceVoidedNotification,
  paymentApprovedNotification,
  paymentRejectedNotification,
  paymentSubmittedNotification,
  paymentVoidedNotification,
} from "./billing";

test("INVOICE_ISSUED: judul, nominal rupiah, jatuh tempo, tautan tagihan", () => {
  const event = invoiceIssuedNotification({ invoiceId: "inv1", title: "SPP September 2026", amount: 150_000, dueDate: "2026-09-10" });
  assert.equal(event.type, "INVOICE_ISSUED");
  assert.equal(event.title, "Tagihan baru: SPP September 2026");
  assert.equal(event.body, "Tagihan SPP September 2026 sebesar Rp 150.000 telah terbit. Jatuh tempo 10 September 2026.");
  assert.deepEqual(event.link, { screen: "invoice", id: "inv1" });
});

test("INVOICE_ISSUED massal: tautan ke daftar tagihan periode", () => {
  const event = bulkInvoiceIssuedNotification({ periodYear: 2026, periodMonth: 9, title: "SPP September 2026", amount: 125_000, dueDate: "2026-09-10" });
  assert.equal(event.type, "INVOICE_ISSUED");
  assert.match(event.body, /Rp 125\.000/);
  assert.deepEqual(event.link, { screen: "invoices", id: "2026-09" });
});

test("INVOICE_VOIDED memuat alasan", () => {
  const event = invoiceVoidedNotification({ invoiceId: "inv1", title: "SPP Oktober 2026", reason: "Siswa pindah" });
  assert.equal(event.type, "INVOICE_VOIDED");
  assert.equal(event.title, "Tagihan dibatalkan");
  assert.equal(event.body, "Tagihan SPP Oktober 2026 dibatalkan oleh sekolah. Alasan: Siswa pindah");
});

test("PAYMENT_SUBMITTED ke admin: nama siswa, kelas, nominal, tautan antrean verifikasi", () => {
  const event = paymentSubmittedNotification({ submissionId: "sub1", studentName: "Budi", className: "VII-A", invoiceTitle: "SPP September 2026", amount: 150_000 });
  assert.equal(event.type, "PAYMENT_SUBMITTED");
  assert.equal(event.body, "Budi (VII-A) mengunggah bukti transfer Rp 150.000 untuk SPP September 2026. Menunggu verifikasi.");
  assert.deepEqual(event.link, { screen: "payment-review", id: "sub1" });
});

test("PAYMENT_APPROVED: transfer vs tunai, lunas vs sebagian, catatan", () => {
  const base = { invoiceId: "inv1", title: "SPP September 2026", amount: 100_000, receiptNo: "KWT-2026-000001", remaining: 50_000, note: null };
  const transfer = paymentApprovedNotification({ ...base, method: "TRANSFER" });
  assert.equal(transfer.title, "Pembayaran diterima");
  assert.equal(transfer.body, "Pembayaran Rp 100.000 untuk SPP September 2026 telah diverifikasi (kuitansi KWT-2026-000001). Sisa tagihan Rp 50.000.");
  const cash = paymentApprovedNotification({ ...base, method: "CASH", remaining: 0, note: "Diterima bendahara" });
  assert.equal(cash.title, "Pembayaran tunai diterima");
  assert.equal(cash.body, "Pembayaran tunai Rp 100.000 untuk SPP September 2026 telah dicatat (kuitansi KWT-2026-000001). Tagihan lunas. Catatan: Diterima bendahara");
  assert.deepEqual(cash.link, { screen: "invoice", id: "inv1" });
});

test("PAYMENT_REJECTED memuat alasan; PAYMENT_VOIDED memuat nomor kuitansi & alasan", () => {
  const rejected = paymentRejectedNotification({ invoiceId: "inv1", title: "SPP September 2026", amount: 150_000, reason: "Bukti tidak terbaca" });
  assert.equal(rejected.type, "PAYMENT_REJECTED");
  assert.equal(rejected.body, "Bukti transfer Rp 150.000 untuk SPP September 2026 ditolak. Alasan: Bukti tidak terbaca");
  const voided = paymentVoidedNotification({ invoiceId: "inv1", title: "SPP September 2026", amount: 150_000, receiptNo: "KWT-2026-000002", reason: "Salah input" });
  assert.equal(voided.type, "PAYMENT_VOIDED");
  assert.equal(voided.body, "Pembayaran Rp 150.000 (kuitansi KWT-2026-000002) untuk SPP September 2026 dibatalkan. Alasan: Salah input");
});
