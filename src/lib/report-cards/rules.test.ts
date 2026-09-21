import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  attendanceWindow,
  averageScore,
  classifyReadiness,
  computePredicate,
  isValidScore,
  missingSubjectIds,
  normalizeDescription,
  orderGradesForDisplay,
  selectPublishTargets,
  summarizeAttendance,
  summarizeAttendanceByStudent,
  type CardGrades,
} from "./rules";

describe("computePredicate (K13 relatif KKM, aritmetika bilangan bulat)", () => {
  const table = (kkm: number, cases: ReadonlyArray<readonly [number, string]>) => {
    for (const [score, expected] of cases) assert.equal(computePredicate(score, kkm), expected, `KKM ${kkm}, nilai ${score}`);
  };

  test("KKM 75: A >= 92, B >= 84, C >= 75", () => {
    table(75, [[100, "A"], [92, "A"], [91, "B"], [84, "B"], [83, "C"], [75, "C"], [74, "D"], [0, "D"]]);
  });

  test("KKM 70: A >= 90, B >= 80, C >= 70", () => {
    table(70, [[100, "A"], [90, "A"], [89, "B"], [80, "B"], [79, "C"], [70, "C"], [69, "D"], [0, "D"]]);
  });

  test("KKM 100: hanya 100 yang A, sisanya D", () => {
    table(100, [[100, "A"], [99, "D"], [0, "D"]]);
  });

  test("KKM 0: tidak pernah D (A >= 67, B >= 34)", () => {
    table(0, [[100, "A"], [67, "A"], [66, "B"], [34, "B"], [33, "C"], [0, "C"]]);
  });

  test("masukan bukan bilangan bulat 0..100 -> RangeError", () => {
    for (const [score, kkm] of [[100.5, 75], [-1, 75], [101, 75], [Number.NaN, 75], [80, 101], [80, -1], [80, 70.5]] as const) {
      assert.throws(() => computePredicate(score, kkm), RangeError, `${score}/${kkm}`);
    }
  });
});

test("isValidScore: 0 dan 100 diterima; string, pecahan, null, di luar rentang ditolak", () => {
  assert.equal(isValidScore(0), true);
  assert.equal(isValidScore(100), true);
  for (const bad of ["90", 100.5, null, undefined, -1, 101, Number.POSITIVE_INFINITY]) assert.equal(isValidScore(bad), false, String(bad));
});

test("averageScore: dibulatkan 2 desimal; kosong -> null", () => {
  assert.equal(averageScore([83, 83, 84]), 83.33);
  assert.equal(averageScore([90, 85]), 87.5);
  assert.equal(averageScore([100]), 100);
  assert.equal(averageScore([1, 2, 2]), 1.67);
  assert.equal(averageScore([]), null);
});

test("normalizeDescription: trim, rapatkan spasi, kosong -> null", () => {
  assert.equal(normalizeDescription("  Sangat   baik\n dalam  aljabar "), "Sangat baik dalam aljabar");
  assert.equal(normalizeDescription("   "), null);
  assert.equal(normalizeDescription(""), null);
  assert.equal(normalizeDescription(null), null);
  assert.equal(normalizeDescription(undefined), null);
});

describe("rekap kehadiran", () => {
  test("summarizeAttendance mengabaikan HADIR dan TERLAMBAT", () => {
    const summary = summarizeAttendance([
      { status: "HADIR", count: 50 },
      { status: "TERLAMBAT", count: 3 },
      { status: "SAKIT", count: 2 },
      { status: "IZIN", count: 1 },
      { status: "ALPHA", count: 4 },
      { status: "SAKIT", count: 1 },
    ]);
    assert.deepEqual(summary, { sick: 3, permit: 1, absent: 4 });
    assert.deepEqual(summarizeAttendance([]), { sick: 0, permit: 0, absent: 0 });
  });

  test("summarizeAttendanceByStudent: per siswa, siswa tanpa baris tidak muncul", () => {
    const map = summarizeAttendanceByStudent([
      { studentId: "s1", status: "SAKIT", count: 2 },
      { studentId: "s2", status: "ALPHA", count: 1 },
      { studentId: "s1", status: "IZIN", count: 1 },
      { studentId: "s1", status: "HADIR", count: 9 },
    ]);
    assert.deepEqual(map.get("s1"), { sick: 2, permit: 1, absent: 0 });
    assert.deepEqual(map.get("s2"), { sick: 0, permit: 0, absent: 1 });
    assert.equal(map.has("s3"), false);
  });

  test("attendanceWindow: dipotong di min(akhir semester, closedThrough); null bila belum ada hari tertutup", () => {
    assert.deepEqual(attendanceWindow("2026-07-13", "2026-12-19", "2026-09-20"), { from: "2026-07-13", to: "2026-09-20" });
    assert.deepEqual(attendanceWindow("2026-01-05", "2026-06-20", "2026-09-20"), { from: "2026-01-05", to: "2026-06-20" });
    assert.equal(attendanceWindow("2026-10-01", "2026-12-19", "2026-09-20"), null);
    assert.deepEqual(attendanceWindow("2026-09-20", "2026-12-19", "2026-09-20"), { from: "2026-09-20", to: "2026-09-20" });
  });
});

const MAPPED = [
  { subjectId: "mtk", sortOrder: 1 },
  { subjectId: "bin", sortOrder: 0 },
  { subjectId: "ipa", sortOrder: 2 },
] as const;

test("missingSubjectIds menjaga sortOrder dan mengabaikan nilai tambahan", () => {
  assert.deepEqual(missingSubjectIds(MAPPED, ["ipa", "ips"]), ["bin", "mtk"]);
  assert.deepEqual(missingSubjectIds(MAPPED, ["bin", "mtk", "ipa"]), []);
  assert.deepEqual(missingSubjectIds([], ["bin"]), []);
});

const card = (id: string, studentId: string, status: "DRAFT" | "PUBLISHED", graded: string[]): CardGrades => ({
  reportCardId: id, studentId, status, gradedSubjectIds: graded,
});

test("classifyReadiness: siap, belum lengkap, tanpa rapor, terbit", () => {
  const readiness = classifyReadiness({
    mapped: MAPPED,
    cards: [card("r1", "s1", "DRAFT", ["bin", "mtk", "ipa"]), card("r2", "s2", "DRAFT", ["bin"]), card("r3", "s3", "PUBLISHED", ["bin"])],
    activeStudentIds: ["s1", "s2", "s3", "s4", "s5"],
    studentsWithCard: new Set(["s1", "s2", "s3", "s5"]),
  });
  assert.deepEqual(readiness.ready, [{ reportCardId: "r1", studentId: "s1" }]);
  assert.deepEqual(readiness.incomplete, [{ reportCardId: "r2", studentId: "s2", missingSubjectIds: ["mtk", "ipa"] }]);
  assert.deepEqual(readiness.published, [{ reportCardId: "r3", studentId: "s3" }]);
  assert.deepEqual(readiness.noReportCard, ["s4"]);
});

describe("selectPublishTargets", () => {
  const cards = [card("r1", "s1", "DRAFT", ["bin", "mtk", "ipa"]), card("r2", "s2", "DRAFT", ["bin"]), card("r3", "s3", "PUBLISHED", ["bin"])];

  test("tanpa studentIds: semua DRAFT + siswa aktif tanpa rapor wajib lengkap", () => {
    const result = selectPublishTargets({ mapped: MAPPED, cards, requestedStudentIds: null, activeWithoutCard: ["s4"] });
    assert.deepEqual(result.toPublish.map((c) => c.reportCardId), ["r1"]);
    assert.deepEqual(result.incomplete, [
      { reportCardId: "r2", studentId: "s2", missingSubjectIds: ["mtk", "ipa"] },
      { reportCardId: null, studentId: "s4", missingSubjectIds: ["bin", "mtk", "ipa"] },
    ]);
  });

  test("dengan studentIds: hanya yang diminta; sudah terbit dilewati; tanpa rapor -> belum lengkap", () => {
    const ok = selectPublishTargets({ mapped: MAPPED, cards, requestedStudentIds: ["s1", "s3"], activeWithoutCard: ["s4"] });
    assert.deepEqual(ok.toPublish.map((c) => c.reportCardId), ["r1"]);
    assert.deepEqual(ok.incomplete, []);
    const missing = selectPublishTargets({ mapped: MAPPED, cards, requestedStudentIds: ["s1", "sX"], activeWithoutCard: [] });
    assert.deepEqual(missing.incomplete, [{ reportCardId: null, studentId: "sX", missingSubjectIds: ["bin", "mtk", "ipa"] }]);
  });
});

test("orderGradesForDisplay: mapel terpetakan menurut sortOrder, lalu sisanya menurut nama", () => {
  const ordered = orderGradesForDisplay(
    [
      { subjectId: "x", subjectName: "Seni" },
      { subjectId: "mtk", subjectName: "Matematika" },
      { subjectId: "y", subjectName: "Prakarya" },
      { subjectId: "bin", subjectName: "Bahasa Indonesia" },
    ],
    new Map([["mtk", 1], ["bin", 0]]),
  );
  assert.deepEqual(ordered.map((g) => g.subjectId), ["bin", "mtk", "y", "x"]);
});
