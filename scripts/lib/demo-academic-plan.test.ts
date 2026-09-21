import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnnouncementBody } from "../../src/lib/announcements/schemas";
import { computePredicate } from "../../src/lib/report-cards/rules";
import { DEMO_REPORT_CLASS_INDEX, demoAnnouncementPlans, demoGradeDescription, demoScore } from "./demo-academic-plan";
import { demoInvoiceOutcome } from "./demo-billing-plan";
import { DEMO_KKM, DEMO_SCHOOLS, DEMO_STUDENTS_PER_SCHOOL } from "./demo-data";

const SUBJECTS = 6;

test("demoScore: bilangan bulat 70..98, deterministik, mencakup predikat A-D pada KKM demo", () => {
  const predicates = new Set<string>();
  for (let s = 0; s < DEMO_STUDENTS_PER_SCHOOL; s += 1) {
    for (let j = 0; j < SUBJECTS; j += 1) {
      const score = demoScore(s, j);
      assert.ok(Number.isInteger(score) && score >= 70 && score <= 98, String(score));
      assert.equal(score, demoScore(s, j));
      predicates.add(computePredicate(score, DEMO_KKM));
    }
  }
  assert.deepEqual([...predicates].sort(), ["A", "B", "C", "D"]);
});

test("demoGradeDescription mengikuti predikat K13", () => {
  assert.match(demoGradeDescription(95, 75), /^Sangat baik/);
  assert.match(demoGradeDescription(85, 75), /^Baik/);
  assert.match(demoGradeDescription(75, 75), /^Cukup/);
  assert.match(demoGradeDescription(74, 75), /^Perlu bimbingan/);
});

test("demoAnnouncementPlans: tiga audiens (ALL, CLASSES kelas rapor, STUDENTS penunggak September), judul unik", () => {
  for (const spec of DEMO_SCHOOLS) {
    const plans = demoAnnouncementPlans(spec);
    assert.deepEqual(plans.map((p) => p.audience), ["ALL", "CLASSES", "STUDENTS"]);
    assert.equal(new Set(plans.map((p) => p.title)).size, 3);
    assert.deepEqual(plans[1]?.classNames, [spec.classes[DEMO_REPORT_CLASS_INDEX]?.name]);
    const reminded = plans[2]?.studentIndexes ?? [];
    assert.equal(reminded.length, 3);
    assert.ok(reminded.every((i) => demoInvoiceOutcome(i, 2) === "UNPAID"));
  }
});

test("demoAnnouncementPlans lolos skema masukan pengumuman (dengan id target contoh)", () => {
  for (const plan of demoAnnouncementPlans(DEMO_SCHOOLS[0]!)) {
    const input = {
      category: plan.category,
      title: plan.title,
      body: plan.body,
      audience: plan.audience,
      ...(plan.audience === "CLASSES" ? { classIds: plan.classNames.map((_, i) => `kelas-${i}`) } : {}),
      ...(plan.audience === "STUDENTS" ? { studentIds: plan.studentIndexes.map((i) => `siswa-${i}`) } : {}),
      publishNow: true,
    };
    assert.equal(createAnnouncementBody.safeParse(input).success, true, plan.title);
  }
});
