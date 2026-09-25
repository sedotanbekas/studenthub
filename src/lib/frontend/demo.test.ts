import { test } from "node:test";
import assert from "node:assert/strict";
import { demoDetail, demoRows, demoStudents } from "./demo";
import { demoPersona } from "./demo-personas";
import type { Row } from "./types";

const STUDENT_PATHS = ["/student/report-cards", "/student/invoices", "/student/payments", "/student/payment-submissions"];

test("siswa demo hanya melihat rapor, tagihan, dan pembayaran miliknya sendiri", () => {
  for (const key of ["STUDENT", "STUDENT_BIMA", "STUDENT_CITRA"]) {
    const persona = demoPersona(key);
    assert.ok(persona.studentId, `${key} punya studentId`);
    const others = demoStudents.filter(s => s.id !== persona.studentId);
    for (const path of STUDENT_PATHS) {
      const text = JSON.stringify(demoRows(path, persona));
      for (const other of others) {
        assert.ok(!text.includes(String(other.name)) && !text.includes(String(other.nisn)), `${key} ${path} membocorkan ${String(other.name)}`);
      }
    }
    assert.ok((demoRows("/student/report-cards", persona) as Row[]).length > 0, `${key} punya rapor`);
    assert.ok((demoRows("/student/invoices", persona) as Row[]).length > 0, `${key} punya tagihan`);
  }
});

test("jalur /student tanpa persona siswa gagal tertutup (tanpa data)", () => {
  for (const path of STUDENT_PATHS) {
    assert.deepEqual(demoRows(path), []);
    assert.deepEqual(demoRows(path, demoPersona("SCHOOL_ADMIN")), []);
  }
});

test("admin sekolah tetap melihat rapor & tagihan seluruh siswa", () => {
  assert.equal((demoRows("/school/report-cards") as Row[]).length, demoStudents.length);
  assert.equal((demoRows("/school/invoices") as Row[]).length, demoStudents.length);
});

test("detail demo: rapor & tagihan milik persona terbuka lengkap; milik siswa lain -> null", () => {
  const personas = ["STUDENT", "STUDENT_BIMA", "STUDENT_CITRA"].map(demoPersona);
  for (const persona of personas) {
    const cards = demoRows("/student/report-cards", persona) as Row[];
    const bills = demoRows("/student/invoices", persona) as Row[];
    for (const card of cards) {
      const detail = demoDetail("/student/report-cards", String(card.id), persona);
      assert.ok(detail && Array.isArray(detail.grades) && detail.grades.length > 0, `${persona.key} ${String(card.id)}`);
      assert.equal(detail?.className, card.className);
    }
    for (const bill of bills) assert.ok(demoDetail("/student/invoices", String(bill.id), persona)?.bankAccount, `${persona.key} ${String(bill.id)}`);
    for (const other of personas.filter(p => p !== persona)) {
      for (const card of demoRows("/student/report-cards", other) as Row[]) assert.equal(demoDetail("/student/report-cards", String(card.id), persona), null);
      for (const bill of demoRows("/student/invoices", other) as Row[]) assert.equal(demoDetail("/student/invoices", String(bill.id), persona), null);
    }
  }
  const alyaCard = String((demoRows("/student/report-cards", personas[0]) as Row[])[0]!.id);
  assert.equal(demoDetail("/student/report-cards", alyaCard), null, "tanpa persona");
  assert.equal(demoDetail("/student/report-cards", alyaCard, demoPersona("SCHOOL_ADMIN")), null, "admin demo tidak memakai jalur siswa");
});
