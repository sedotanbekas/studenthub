import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  cardSubjectErrors,
  duplicateStudentErrors,
  eligibilityErrors,
  groupAttendanceSnapshots,
  groupGradeRefresh,
  planGradeWrites,
  type ExistingGrade,
  type SubjectInfo,
} from "./grade-plan";

describe("validasi baris nilai massal", () => {
  test("studentId ganda -> error per baris setelah kemunculan pertama", () => {
    const errors = duplicateStudentErrors([{ studentId: "a" }, { studentId: "b" }, { studentId: "a" }, { studentId: "a" }]);
    assert.deepEqual(errors.map((e) => [e.index, e.studentId, e.code]), [[2, "a", "DUPLICATE_STUDENT"], [3, "a", "DUPLICATE_STUDENT"]]);
    assert.deepEqual(duplicateStudentErrors([{ studentId: "a" }, { studentId: "b" }]), []);
  });

  test("siswa tidak layak / punya rapor di kelas lain -> error per baris", () => {
    const errors = eligibilityErrors([{ studentId: "in" }, { studentId: "out" }, { studentId: "moved" }], {
      eligible: new Set(["in", "moved"]),
      otherClass: new Map([["moved", "VII-B"]]),
    });
    assert.deepEqual(errors.map((e) => [e.index, e.studentId, e.code]), [[1, "out", "STUDENT_NOT_ELIGIBLE"], [2, "moved", "REPORT_CARD_OTHER_CLASS"]]);
    assert.match(errors[1]?.message ?? "", /VII-B/);
  });

  test("nilai satu rapor: mapel ganda & mapel di luar kelas (kecuali sudah dinilai) -> error", () => {
    const errors = cardSubjectErrors(
      [{ subjectId: "mtk" }, { subjectId: "old" }, { subjectId: "foreign" }, { subjectId: "mtk" }],
      new Set(["mtk", "bin"]),
      new Set(["old"]),
    );
    assert.deepEqual(errors.map((e) => [e.index, e.subjectId, e.code]), [[2, "foreign", "SUBJECT_NOT_IN_CLASS"], [3, "mtk", "DUPLICATE_SUBJECT"]]);
  });
});

const MTK: SubjectInfo = { id: "mtk", name: "Matematika", kkm: 75 };
const SUBJECTS = new Map([["mtk", MTK]]);
const existing = (id: string, reportCardId: string, score: number, description: string | null = null): ExistingGrade => ({
  id, reportCardId, subjectId: "mtk", score, description, subjectNameSnapshot: "Matematika", kkmSnapshot: 75, predicate: "C",
});

describe("planGradeWrites", () => {
  test("buat baru, ubah yang berbeda, hapus skor null, lewati yang sama", () => {
    const plan = planGradeWrites(
      [
        { reportCardId: "r1", subjectId: "mtk", score: 92, description: "Baik" },
        { reportCardId: "r2", subjectId: "mtk", score: 80, description: null },
        { reportCardId: "r3", subjectId: "mtk", score: null, description: null },
        { reportCardId: "r4", subjectId: "mtk", score: 75, description: null },
        { reportCardId: "r5", subjectId: "mtk", score: null, description: null },
      ],
      [existing("g2", "r2", 70), existing("g3", "r3", 60), existing("g4", "r4", 75)],
      SUBJECTS,
    );
    assert.deepEqual(plan.creates, [
      { reportCardId: "r1", subjectId: "mtk", subjectNameSnapshot: "Matematika", kkmSnapshot: 75, score: 92, predicate: "A", description: "Baik" },
    ]);
    assert.deepEqual(plan.updates, [
      { id: "g2", data: { subjectNameSnapshot: "Matematika", kkmSnapshot: 75, score: 80, predicate: "C", description: null } },
    ]);
    assert.deepEqual(plan.deleteIds, ["g3"]);
    assert.equal(plan.unchanged, 1);
  });

  test("perubahan KKM/nama mapel menyegarkan snapshot walau skor sama", () => {
    const renamed = new Map([["mtk", { id: "mtk", name: "Matematika Wajib", kkm: 80 }]]);
    const plan = planGradeWrites([{ reportCardId: "r4", subjectId: "mtk", score: 75, description: null }], [existing("g4", "r4", 75)], renamed);
    assert.deepEqual(plan.updates, [
      { id: "g4", data: { subjectNameSnapshot: "Matematika Wajib", kkmSnapshot: 80, score: 75, predicate: "D", description: null } },
    ]);
  });

  test("deskripsi tidak dikirim (undefined) mempertahankan deskripsi tersimpan; null menghapusnya", () => {
    const kept = planGradeWrites([{ reportCardId: "r1", subjectId: "mtk", score: 85, description: undefined }], [existing("g1", "r1", 80, "Deskripsi lama")], SUBJECTS);
    assert.deepEqual(kept.updates, [
      { id: "g1", data: { subjectNameSnapshot: "Matematika", kkmSnapshot: 75, score: 85, predicate: "B", description: "Deskripsi lama" } },
    ]);
    const same = planGradeWrites([{ reportCardId: "r1", subjectId: "mtk", score: 80, description: undefined }], [existing("g1", "r1", 80, "Deskripsi lama")], SUBJECTS);
    assert.deepEqual([same.updates, same.unchanged], [[], 1], "skor sama tanpa deskripsi = tidak berubah");
    const cleared = planGradeWrites([{ reportCardId: "r1", subjectId: "mtk", score: 80, description: null }], [existing("g1", "r1", 80, "Deskripsi lama")], SUBJECTS);
    assert.deepEqual(cleared.updates, [
      { id: "g1", data: { subjectNameSnapshot: "Matematika", kkmSnapshot: 75, score: 80, predicate: "C", description: null } },
    ]);
    const fresh = planGradeWrites([{ reportCardId: "r9", subjectId: "mtk", score: 90, description: undefined }], [], SUBJECTS);
    assert.equal(fresh.creates[0]?.description, null, "nilai baru tanpa deskripsi -> null");
  });

  test("mapel tanpa info -> Error (bug pemanggil)", () => {
    assert.throws(() => planGradeWrites([{ reportCardId: "r1", subjectId: "x", score: 90, description: null }], [], SUBJECTS));
  });
});

test("groupGradeRefresh: satu grup per (mapel, predikat) dengan snapshot terkini", () => {
  const subjects = new Map([
    ["mtk", { id: "mtk", name: "Matematika", kkm: 80 }],
    ["bin", { id: "bin", name: "B. Indonesia", kkm: 70 }],
  ]);
  const groups = groupGradeRefresh(
    [
      { id: "g1", subjectId: "mtk", score: 95 },
      { id: "g2", subjectId: "mtk", score: 94 },
      { id: "g3", subjectId: "mtk", score: 79 },
      { id: "g4", subjectId: "bin", score: 79 },
    ],
    subjects,
  );
  assert.deepEqual(groups, [
    { ids: ["g1", "g2"], subjectNameSnapshot: "Matematika", kkmSnapshot: 80, predicate: "A" },
    { ids: ["g3"], subjectNameSnapshot: "Matematika", kkmSnapshot: 80, predicate: "D" },
    { ids: ["g4"], subjectNameSnapshot: "B. Indonesia", kkmSnapshot: 70, predicate: "C" },
  ]);
});

test("groupAttendanceSnapshots: rapor dengan rekap sama digabung; tanpa baris -> nol", () => {
  const groups = groupAttendanceSnapshots(
    [{ id: "r1", studentId: "s1" }, { id: "r2", studentId: "s2" }, { id: "r3", studentId: "s3" }],
    new Map([["s1", { sick: 1, permit: 0, absent: 2 }], ["s3", { sick: 1, permit: 0, absent: 2 }]]),
  );
  assert.deepEqual(groups, [
    { ids: ["r1", "r3"], sickDays: 1, permitDays: 0, absentDays: 2 },
    { ids: ["r2"], sickDays: 0, permitDays: 0, absentDays: 0 },
  ]);
});
