import { test } from "node:test";
import { schoolAdminSchema } from "@/lib/school-admins/schemas";
import assert from "node:assert/strict";
import { demoDetail, demoRows, demoStudents, demoUnreadCount } from "./demo";
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

test("kartu konfirmasi identitas demo (A2): kelas & NISN tersamar milik persona siswa; non-siswa kosong", async () => {
  const { identityFacts, EMPTY_FACTS } = await import("./identity-confirm-rules");
  const { demoPersona } = await import("./demo-personas");
  for (const key of ["STUDENT", "STUDENT_BIMA", "STUDENT_CITRA"]) {
    const persona = demoPersona(key);
    const student = demoStudents.find(s => s.id === persona.studentId);
    const facts = identityFacts(demoRows("/student/profile", persona));
    assert.equal(facts.className, persona.className, key);
    assert.equal(facts.maskedNisn, `••••${String(student?.nisn).slice(-4)}`, key);
  }
  assert.deepEqual(identityFacts(demoRows("/student/profile", demoPersona("SCHOOL_ADMIN"))), EMPTY_FACTS);
});

test("demoUnreadCount: sama dengan item kotak masuk persona tanpa readAt, dan > 0", async () => {
  const { DEMO_PERSONAS } = await import("./demo-personas");
  for (const persona of [undefined, ...DEMO_PERSONAS]) {
    const rows = demoRows("/notifications", persona) as Array<{ readAt?: string | null }>;
    assert.equal(demoUnreadCount(persona), rows.filter(r => !r.readAt).length, persona?.key ?? "tanpa persona");
    assert.ok(demoUnreadCount(persona) > 0);
  }
});

test("demo notifikasi absensi (N4): Alya mendapat Alpa ber-CTA, admin mendapat rekap; persona lain tidak; tanpa nama siswa lain", async () => {
  const { demoPersona } = await import("./demo-personas");
  const { notificationCta } = await import("./notification-cta");
  const { localParts } = await import("@/lib/time/zone");
  const today = localParts(new Date(), "WIB").ymd;
  const attendance = (key: string) => (demoRows("/notifications", demoPersona(key)) as Array<Record<string, unknown>>).filter(r => String(r.type ?? "").startsWith("ATTENDANCE_"));

  const [alpha, ...restAlya] = attendance("STUDENT");
  assert.equal(restAlya.length, 0);
  assert.equal(alpha?.type, "ATTENDANCE_ALPHA");
  assert.equal(alpha?.readAt, null);
  assert.equal(notificationCta(alpha!, today)?.kind, "link", "tombol ajukan izin aktif");
  const date = (alpha!.data as { id: string }).id;
  assert.notEqual(new Date(`${date}T00:00:00Z`).getUTCDay(), 0, "bukan hari Minggu (bukan hari sekolah demo)");
  assert.ok(date < today);

  const [summary] = attendance("SCHOOL_ADMIN");
  assert.equal(summary?.type, "ATTENDANCE_DAY_SUMMARY");
  assert.equal(summary?.category, "ATTENDANCE");
  assert.match(String(summary?.body), /^Alpa 8 · Terlambat 24 · Izin 18 · Sakit 12\. 3 perlu ditinjau\.$/);
  assert.deepEqual(notificationCta(summary!, today), { kind: "link", label: "Buka kehadiran", href: `/hub/attendance?tanggal=${date}` });

  for (const key of ["STUDENT_BIMA", "STUDENT_CITRA", "SPONSOR", "SUPER_ADMIN"]) assert.deepEqual(attendance(key), [], key);
  const alyaInbox = JSON.stringify(demoRows("/notifications", demoPersona("STUDENT")));
  for (const other of demoStudents.filter(s => s.id !== "s1")) assert.ok(!alyaInbox.includes(String(other.name)), String(other.name));
});

test("previousDemoSchoolDay melewati Minggu", async () => {
  const { previousDemoSchoolDay } = await import("./demo-notifications");
  assert.equal(previousDemoSchoolDay("2031-03-18"), "2031-03-17", "Selasa -> Senin");
  assert.equal(previousDemoSchoolDay("2031-03-17"), "2031-03-15", "Senin -> Sabtu");
});

test("demo admin sekolah (N2): lolos skema SchoolAdmin, tepat satu admin utama, pilihan kabar contoh", () => {
  const admins = demoRows("/school/admins") as unknown[];
  for (const admin of admins) assert.doesNotThrow(() => schoolAdminSchema.parse(admin));
  assert.equal((admins as Array<{ isPrimary: boolean }>).filter(a => a.isPrimary).length, 1);
  assert.deepEqual(demoRows("/me/notification-preferences"), { mutedCategories: [], mutableCategories: ["FINANCE", "STUDENT_AFFAIRS", "ATTENDANCE"], updatedAt: null, updatedBy: null });
});

test("demo pengingat absen (N5): DTO pengaturan, bukan baris monitor kehadiran", async () => {
  const { attendanceReminderSettingsSchema } = await import("@/lib/schools/reminder-schemas");
  const settings = demoRows("/school/settings/attendance-reminder");
  assert.doesNotThrow(() => attendanceReminderSettingsSchema.parse(settings));
  assert.equal(Array.isArray(settings), false);
});
