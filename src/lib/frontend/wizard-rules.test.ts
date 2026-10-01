import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adminProblem, bankProblem, bulkScopeBody, credentialsCsv, defaultBillingPeriod, defaultDueDate, defaultInvoiceTitle, identityProblem, importFileProblem,
  importSummary, locationProblem, loginHint, problemRows, provinceCenter, publishPlan, skipSummary, subjectProgress, timezoneForProvince,
} from "./wizard-rules";

// ---- Impor siswa
test("berkas impor: hanya .xlsx/.csv maks 2 MB", () => {
  assert.equal(importFileProblem({ name: "siswa.xlsx", size: 1000 }), null);
  assert.equal(importFileProblem({ name: "SISWA.CSV", size: 1000 }), null);
  assert.match(importFileProblem({ name: "siswa.pdf", size: 1000 }) ?? "", /xlsx/);
  assert.match(importFileProblem({ name: "siswa.xlsx", size: 3 * 1024 * 1024 }) ?? "", /2 MB/);
});

const REPORT = {
  totalRows: 4, validRows: 2, errorRows: 1, warningRows: 1,
  rows: [
    { row: 2, nisn: "1", name: "A", errors: [], warnings: [] },
    { row: 3, nisn: "2", name: "B", errors: [], warnings: ["NISN pernah lulus"] },
    { row: 4, nisn: null, name: "C", errors: ["NISN wajib 10 digit"], warnings: [] },
    { row: 5, nisn: "4", name: "D", errors: [], warnings: [] },
  ],
};

test("ringkasan impor: baris bermasalah menghalangi simpan; galat ditampilkan lebih dulu", () => {
  assert.deepEqual(importSummary(REPORT), { canSave: false, tone: "warning", text: "1 baris bermasalah: perbaiki di Excel lalu unggah ulang. 2 baris siap, 1 berperingatan." });
  assert.deepEqual(problemRows(REPORT).map((r) => r.row), [4, 3]);
  const clean = { ...REPORT, errorRows: 0, warningRows: 0, validRows: 4 };
  assert.deepEqual(importSummary(clean), { canSave: true, tone: "success", text: "Semua 4 baris siap disimpan." });
});

test("CSV kata sandi awal: BOM untuk Excel, kutip bila perlu", () => {
  const csv = credentialsCsv([{ row: 2, nisn: "0012345678", nis: "S-1", name: "Siti, \"Ani\"", className: "X A", temporaryPassword: "Tmp123" }]);
  assert.ok(csv.startsWith("﻿Baris,NISN,NIS,Nama,Kelas,Kata sandi sementara\r\n"));
  assert.ok(csv.includes("2,0012345678,S-1,\"Siti, \"\"Ani\"\"\",X A,Tmp123"));
});

test("CSV kata sandi: nama/kelas dari berkas unggahan tidak dieksekusi sebagai rumus Excel; kata sandi apa adanya", () => {
  const csv = credentialsCsv([{ row: 3, nisn: "0012345679", nis: "", name: "=HYPERLINK(\"http://x\")", className: "+X", temporaryPassword: "-Tmp9" }]);
  assert.ok(csv.includes("3,0012345679,,\"'=HYPERLINK(\"\"http://x\"\")\",'+X,-Tmp9\r\n"), csv);
});

// ---- Tagihan SPP massal
test("periode, judul, dan jatuh tempo bawaan", () => {
  assert.deepEqual(defaultBillingPeriod("2026-10-01"), { periodYear: 2026, periodMonth: 10 });
  assert.equal(defaultInvoiceTitle(2026, 10), "SPP Oktober 2026");
  assert.equal(defaultDueDate(2026, 2), "2026-02-10");
});

test("cakupan tagihan massal", () => {
  assert.deepEqual(bulkScopeBody("SCHOOL", [], []), { scope: { type: "SCHOOL" } });
  assert.deepEqual(bulkScopeBody("CLASSES", ["c1"], []), { scope: { type: "CLASSES", classIds: ["c1"] } });
  assert.match(bulkScopeBody("CLASSES", [], []).problem ?? "", /kelas/);
  assert.match(bulkScopeBody("STUDENTS", [], []).problem ?? "", /siswa/);
});

test("ringkasan siswa yang dilewati per alasan", () => {
  const skipped = [{ studentId: "a", reason: "ALREADY_BILLED" }, { studentId: "b", reason: "ALREADY_BILLED" }, { studentId: "c", reason: "EXEMPT" }];
  assert.deepEqual(skipSummary(skipped), ["2 sudah punya tagihan periode ini", "1 bebas SPP (nominal 0)"]);
});

// ---- Rapor
const READINESS = {
  subjectCount: 2,
  ready: [{ reportCardId: "r1", studentId: "s1" }],
  incomplete: [{ reportCardId: "r2", studentId: "s2", missingSubjectIds: ["mtk"] }],
  noReportCard: ["s3"],
  published: [{ reportCardId: "r4", studentId: "s4" }],
  attendanceUnclosedDates: [] as string[],
};

test("kemajuan nilai per mapel dihitung dari siswa yang belum bernilai", () => {
  const subjects = [{ subjectId: "mtk", name: "Matematika" }, { subjectId: "bin", name: "B. Indonesia" }];
  assert.deepEqual(subjectProgress(READINESS, subjects), [{ subjectId: "mtk", name: "Matematika", missing: 2 }, { subjectId: "bin", name: "B. Indonesia", missing: 1 }]);
});

test("rencana terbit: hanya rapor lengkap; absensi belum ditutup menghalangi", () => {
  assert.deepEqual(publishPlan(READINESS), { studentIds: ["s1"], blocked: null, note: "1 rapor siap terbit. 2 siswa belum lengkap nilainya; 1 sudah terbit." });
  assert.match(publishPlan({ ...READINESS, attendanceUnclosedDates: ["2026-12-19"] }).blocked ?? "", /19 Des 2026/);
  assert.match(publishPlan({ ...READINESS, ready: [] }).blocked ?? "", /Belum ada/);
});

// ---- Daftarkan sekolah
test("zona waktu ditebak dari provinsi", () => {
  assert.equal(timezoneForProvince("32"), "WIB");
  assert.equal(timezoneForProvince("62"), "WIB");
  assert.equal(timezoneForProvince("51"), "WITA");
  assert.equal(timezoneForProvince("73"), "WITA");
  assert.equal(timezoneForProvince("81"), "WIT");
  assert.equal(timezoneForProvince("94"), "WIT");
});

test("peta melompat ke ibu kota provinsi terpilih (38 provinsi, semua di daratan Indonesia)", () => {
  const codes = ["11", "12", "13", "14", "15", "16", "17", "18", "19", "21", "31", "32", "33", "34", "35", "36", "51", "52", "53", "61", "62", "63", "64", "65", "71", "72", "73", "74", "75", "76", "81", "82", "91", "92", "93", "94", "95", "96"];
  for (const code of codes) {
    const center = provinceCenter(code);
    assert.ok(center, `provinsi ${code} punya titik tengah`);
    assert.ok(center.latitude > -11.5 && center.latitude < 6.5 && center.longitude > 94.5 && center.longitude < 141.5, `provinsi ${code} di Indonesia`);
  }
  const bandung = provinceCenter("32");
  assert.ok(bandung && Math.abs(bandung.latitude + 6.92) < 0.1 && Math.abs(bandung.longitude - 107.61) < 0.1);
  assert.equal(provinceCenter(""), null);
  assert.equal(provinceCenter("99"), null);
});

test("validasi identitas, lokasi, rekening, dan admin utama", () => {
  assert.equal(identityProblem({ name: "SMK Bina Nusa", npsn: "", educationLevel: "SMK" }), null);
  assert.match(identityProblem({ name: "SM", npsn: "", educationLevel: "SMK" }) ?? "", /3/);
  assert.match(identityProblem({ name: "SMK Bina", npsn: "123", educationLevel: "SMK" }) ?? "", /8 digit/);
  assert.match(identityProblem({ name: "SMK Bina", npsn: "", educationLevel: null }) ?? "", /jenjang/);
  assert.equal(locationProblem({ latitude: -6.9, longitude: 107.6, radiusM: 150, provinceCode: "32", cityCode: "32.73" }), null);
  assert.match(locationProblem({ latitude: 40, longitude: 107.6, radiusM: 150, provinceCode: "32", cityCode: "32.73" }) ?? "", /Indonesia/);
  assert.match(locationProblem({ latitude: -6.9, longitude: 107.6, radiusM: 20, provinceCode: "32", cityCode: "32.73" }) ?? "", /50/);
  assert.match(locationProblem({ latitude: -6.9, longitude: 107.6, radiusM: 150, provinceCode: "", cityCode: "" }) ?? "", /provinsi/);
  assert.equal(bankProblem({ bankName: "", bankAccountNumber: "", bankAccountHolder: "" }), null);
  assert.match(bankProblem({ bankName: "BRI", bankAccountNumber: "", bankAccountHolder: "" }) ?? "", /semua/);
  assert.match(bankProblem({ bankName: "BRI", bankAccountNumber: "12ab", bankAccountHolder: "X" }) ?? "", /angka/);
  assert.equal(adminProblem({ name: "Admin", email: "", hasNpsn: true }), null);
  assert.match(adminProblem({ name: "Admin", email: "", hasNpsn: false }) ?? "", /email/);
  assert.match(adminProblem({ name: "Admin", email: "bukan-email", hasNpsn: true }) ?? "", /email/);
});

test("petunjuk masuk admin utama", () => {
  assert.equal(loginHint({ npsn: "69873590", email: null }), "Masuk dengan NPSN 69873590");
  assert.equal(loginHint({ npsn: null, email: "a@b.id" }), "Masuk dengan email a@b.id");
});
