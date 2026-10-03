import { test } from "node:test";
import assert from "node:assert/strict";
import { checklistComplete, isSchoolSetupFacts, schoolSetupSteps, sponsorOnboardingSteps, type SchoolSetupFacts } from "./onboarding-rules";

const READY: SchoolSetupFacts = {
  educationLevel: "SMK", checkInOpenMinute: 300, startMinute: 446, lateToleranceMinutes: 15, checkInCloseMinute: 745, dayEndMinute: 900, schoolDaysMask: 31,
  bankName: "BRI", schedule: { checkInOpen: "05:00", checkInClose: "12:25" },
  setupChecklist: { hasTermToday: true, nextTermStartDate: null, classCount: 2, subjectCount: 1, activeStudentCount: 30, holidayCount: 1 },
};
const status = (facts: SchoolSetupFacts) => Object.fromEntries(schoolSetupSteps(facts).map((s) => [s.key, s.status]));

test("persiapan sekolah lengkap: semua langkah selesai", () => {
  assert.deepEqual(status(READY), { academics: "done", schedule: "done", reminder: "done", students: "done", holidays: "done", bank: "done" });
  assert.equal(checklistComplete(schoolSetupSteps(READY)), true);
});

test("sekolah baru (seperti Bina Nusa): akademik & siswa wajib, jadwal bawaan diminta diperiksa", () => {
  const fresh: SchoolSetupFacts = {
    ...READY, educationLevel: null, checkInOpenMinute: 360, startMinute: 420, checkInCloseMinute: 600, bankName: null,
    schedule: { checkInOpen: "06:00", checkInClose: "10:00" },
    setupChecklist: { hasTermToday: false, nextTermStartDate: null, classCount: 2, subjectCount: 0, activeStudentCount: 0, holidayCount: 0 },
  };
  assert.deepEqual(status(fresh), { academics: "todo", schedule: "optional", reminder: "optional", students: "todo", holidays: "optional", bank: "optional" });
  assert.equal(checklistComplete(schoolSetupSteps(fresh)), false);
  const academics = schoolSetupSteps(fresh)[0]!;
  assert.match(academics.summary, /jenjang/);
  assert.match(academics.summary, /semester/);
  assert.equal(academics.href, "/hub/academics");
  assert.equal(schoolSetupSteps(fresh).find((s) => s.key === "bank")?.href, null, "rekening diatur super admin");
});

test("semester berikutnya sudah dibuat dihitung siap", () => {
  const facts = { ...READY, setupChecklist: { ...READY.setupChecklist, hasTermToday: false, nextTermStartDate: "2027-01-04" } };
  assert.equal(status(facts).academics, "done");
});

test("sponsor baru: menunggu persetujuan, belum isi saldo, belum ada kampanye", () => {
  const steps = sponsorOnboardingSteps({ status: "PENDING", statusReason: null, balance: 0, pendingTopUps: 0, adsCount: 0, liveCount: 0 });
  assert.deepEqual(steps.map((s) => [s.key, s.status]), [["approval", "waiting"], ["topup", "todo"], ["campaign", "todo"], ["live", "todo"]]);
  assert.equal(checklistComplete(steps), false);
});

test("sponsor: top-up menunggu verifikasi & kampanye menunggu tayang", () => {
  const steps = sponsorOnboardingSteps({ status: "APPROVED", statusReason: null, balance: 0, pendingTopUps: 1, adsCount: 1, liveCount: 0 });
  assert.deepEqual(steps.map((s) => s.status), ["done", "waiting", "done", "waiting"]);
});

test("sponsor tayang: semua selesai; ditangguhkan memberi alasan", () => {
  assert.equal(checklistComplete(sponsorOnboardingSteps({ status: "APPROVED", statusReason: null, balance: 50_000, pendingTopUps: 0, adsCount: 2, liveCount: 1 })), true);
  const suspended = sponsorOnboardingSteps({ status: "SUSPENDED", statusReason: "Dokumen kedaluwarsa", balance: 0, pendingTopUps: 0, adsCount: 0, liveCount: 0 });
  assert.equal(suspended[0]!.status, "todo");
  assert.match(suspended[0]!.summary, /Dokumen kedaluwarsa/);
});

test("profil berbentuk asing tidak dipakai (panel pelengkap tidak boleh merobohkan Beranda)", () => {
  assert.equal(isSchoolSetupFacts(READY), true);
  for (const bad of [null, undefined, [], {}, "x", { ...READY, setupChecklist: null }, { ...READY, schedule: undefined }, { ...READY, setupChecklist: { ...READY.setupChecklist, classCount: "2" } }]) {
    assert.equal(isSchoolSetupFacts(bad), false, JSON.stringify(bad));
  }
});
