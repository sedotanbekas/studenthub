import { test } from "node:test";
import assert from "node:assert/strict";
import { operations } from "./catalog";
import type { Operation } from "./types";
import { modulesFor } from "./modules";
import { ACTION_LABELS, detailBase, HIDDEN_VIEWS, isDangerAction, isHiddenField, NESTED_DETAIL_BASES, pageActions, splitActions, VIEW_LABELS, viewsFor } from "./workspace-rules";

const op = (id: string, method: string, path: string): Operation => ({ id, method, path, title: id, action: "", parameters: [], multipart: false });

test("tampilan: hanya GET tanpa {id}, tampilan utama di depan, tampilan teknis disembunyikan", () => {
  const ops = [op("listNotifications", "GET", "/notifications"), op("getUnreadNotificationCount", "GET", "/notifications/unread-count"), op("getNotification", "GET", "/notifications/{id}")];
  assert.deepEqual(viewsFor(ops, "listNotifications").map((v) => v.id), ["listNotifications"]);
  const billing = [op("listSchoolPaymentSubmissions", "GET", "/school/payment-submissions"), op("listSchoolInvoices", "GET", "/school/invoices")];
  assert.deepEqual(viewsFor(billing, "listSchoolInvoices").map((v) => v.id), ["listSchoolInvoices", "listSchoolPaymentSubmissions"]);
});

test("aksi halaman: tombol utama = buat untuk tampilan ini; aksi per baris TIDAK masuk halaman", () => {
  const ops = [
    op("listSchoolStudents", "GET", "/school/students"), op("createSchoolStudent", "POST", "/school/students"), op("importSchoolStudents", "POST", "/school/students/import"),
    op("downloadStudentImportTemplate", "GET", "/school/students/import/template"), op("activateSchoolStudent", "POST", "/school/students/{id}/activate"),
  ];
  const actions = pageActions(ops, "/school/students");
  assert.equal(actions.create?.id, "createSchoolStudent");
  assert.deepEqual(actions.secondary.map((a) => a.id), ["importSchoolStudents", "downloadStudentImportTemplate"]);
});

test("aksi halaman tanpa buat di tampilan aktif: tidak ada tombol utama palsu", () => {
  const ops = [op("listSchoolPaymentSubmissions", "GET", "/school/payment-submissions"), op("createSchoolInvoice", "POST", "/school/invoices")];
  const actions = pageActions(ops, "/school/payment-submissions");
  assert.equal(actions.create, undefined);
  assert.deepEqual(actions.secondary.map((a) => a.id), ["createSchoolInvoice"]);
});

test("aksi milik tampilan yang dibuka didahulukan agar tidak terselip di menu Lainnya", () => {
  const ops = [
    op("getAdSettings", "GET", "/platform/settings/ads"), op("updateAdSettings", "PATCH", "/platform/settings/ads"),
    op("recloseAttendanceDay", "POST", "/platform/attendance/close-day"), op("getAttendanceTestMode", "GET", "/platform/attendance/test-mode"),
    op("enableAttendanceTestMode", "POST", "/platform/attendance/test-mode"), op("disableAttendanceTestMode", "DELETE", "/platform/attendance/test-mode"),
  ];
  const testMode = pageActions(ops, "/platform/attendance/test-mode");
  assert.equal(testMode.create?.id, "enableAttendanceTestMode");
  assert.deepEqual(splitActions(testMode.secondary).visible.map((a) => a.id), ["disableAttendanceTestMode", "updateAdSettings"]);
  assert.deepEqual(pageActions(ops, "/platform/settings/ads").secondary.map((a) => a.id)[0], "updateAdSettings");
});

test("konfirmasi bahaya: hapus/nonaktifkan/reset; membuka mode uji absensi berbahaya, menguncinya kembali tidak", () => {
  assert.equal(isDangerAction(op("deleteHoliday", "DELETE", "/school/holidays/{id}")), true);
  assert.equal(isDangerAction(op("resetPassword", "POST", "/school/students/{id}/reset-password")), true);
  assert.equal(isDangerAction(op("createSchoolClass", "POST", "/school/classes")), false);
  assert.equal(isDangerAction(op("enableAttendanceTestMode", "POST", "/platform/attendance/test-mode")), true);
  assert.equal(isDangerAction(op("disableAttendanceTestMode", "DELETE", "/platform/attendance/test-mode")), false);
});

test("aksi sekunder: maks 2 tampil sebagai tombol, sisanya ke menu Lainnya", () => {
  const ids = ["a", "b", "c", "d"].map((id) => op(id, "POST", `/x/${id}`));
  assert.deepEqual(splitActions(ids).visible.map((o) => o.id), ["a", "b"]);
  assert.deepEqual(splitActions(ids).overflow.map((o) => o.id), ["c", "d"]);
  assert.deepEqual(splitActions(ids.slice(0, 3)).overflow.map((o) => o.id), ["c"]);
});

test("kolom/detail id mentah disembunyikan; tautan berkas tetap tampil", () => {
  for (const key of ["id", "academicYearId", "classIds", "schoolId"]) assert.equal(isHiddenField(key), true, key);
  for (const key of ["proofFileId", "name", "nisn", "paidAt"]) assert.equal(isHiddenField(key), false, key);
});

test("setiap tombol tambah & tampilan di menu punya teks spesifik (bukan 'Tambah baru')", () => {
  const creates = operations.filter((o) => o.method === "POST" && /^create/.test(o.id) && !o.path.includes("{"));
  for (const create of creates.filter((o) => /^\/(school|platform|sponsor|student)\//.test(o.path))) {
    assert.ok(ACTION_LABELS[create.id]?.label, `label tombol untuk ${create.id}`);
    assert.doesNotMatch(ACTION_LABELS[create.id]!.label, /^Tambah baru$/);
  }
  assert.equal(VIEW_LABELS.listSchoolInvoices, "Tagihan");
});

test("operasi berparameter selain {id} (koreksi absensi, tren siswa/kelas) jadi aksi halaman", () => {
  const ops = [
    op("monitorAttendanceDaily", "GET", "/school/attendance/daily"),
    op("correctStudentAttendanceDay", "PUT", "/school/attendance/students/{studentId}/days/{date}"),
    op("monitorAttendanceClassTrend", "GET", "/school/attendance/analytics/classes/{classId}/trend"),
    op("getAttendanceRecord", "GET", "/school/attendance/{id}"),
  ];
  assert.deepEqual(pageActions(ops, "/school/attendance/daily").secondary.map((a) => a.id), ["correctStudentAttendanceDay", "monitorAttendanceClassTrend"]);
});

test("id yang bermakna bagi admin tetap tampil (rujukan audit, sidik perangkat)", () => {
  assert.equal(isHiddenField("entityId"), false);
  assert.equal(isHiddenField("deviceId"), false);
});

test("setiap operasi menu terjangkau: tampilan, aksi halaman, atau jendela detail baris", () => {
  const dedicated = new Set(["my-attendance", "school-theme", "campaigns", "analytics", "balance", "ad-review", "topups", "academics"]);
  const unreachable: string[] = [];
  for (const entry of (["SCHOOL_ADMIN", "SUPER_ADMIN", "SPONSOR", "STUDENT"] as const).flatMap((role) => modulesFor(role))) {
    if (dedicated.has(entry.key)) continue;
    const available = operations.filter((o) => entry.paths.some((path) => o.path === path || o.path.startsWith(`${path}/`)));
    const views = viewsFor(available, entry.primary);
    const pageLevel = new Set(views.flatMap((v) => { const a = pageActions(available, v.path); return [a.create, ...a.secondary]; }).filter((o): o is Operation => Boolean(o)).map((o) => o.id));
    const bases = [...views.map((v) => detailBase(v.path)), ...NESTED_DETAIL_BASES];
    for (const candidate of available) {
      const ok = views.includes(candidate) || pageLevel.has(candidate.id) || HIDDEN_VIEWS.has(candidate.id) || bases.some((base) => candidate.path.startsWith(`${base}/{id}`));
      if (!ok) unreachable.push(`${entry.key}:${candidate.id}`);
    }
  }
  assert.deepEqual(unreachable, []);
});

test("rekap bulanan (A3): kedua operasi ada di katalog (proxy /api/web hanya meneruskan isi katalog) dan tidak jadi tab generik", () => {
  for (const id of ["monitorAttendanceMonthlyRecap", "exportAttendanceMonthlyRecap"]) {
    assert.ok(operations.some((op) => op.id === id), id);
    assert.ok(HIDDEN_VIEWS.has(id), id);
  }
});
