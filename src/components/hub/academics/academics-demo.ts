import type { AcademicsData } from "./use-academics";

/**
 * Data contoh halaman Akademik untuk mode demo (persona admin di staging): satu tahun ajaran berjalan dengan
 * Semester Ganjil aktif, lima kelas SMA, dan dua mapel. Hanya untuk dilihat; simpan diblokir di useAcademics.
 */
export function demoAcademics(today: string): AcademicsData {
  const year = Number(today.slice(5, 7)) >= 7 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const name = `${year}/${year + 1}`;
  const terms = [
    { id: "term1", academicYearId: "year1", semester: "GANJIL" as const, label: `Semester Ganjil ${name}`, startDate: `${year}-07-13`, endDate: `${year}-12-19`, isActive: true },
    { id: "term2", academicYearId: "year1", semester: "GENAP" as const, label: `Semester Genap ${name}`, startDate: `${year + 1}-01-05`, endDate: `${year + 1}-06-26`, isActive: false },
  ];
  const classes = ["X IPA 1", "X IPA 2", "XI IPA 1", "XI IPS 2", "XII IPA 1"].map((className, i) => ({
    id: `c${i}`, academicYearId: "year1", academicYearName: name, name: className, gradeLevel: 10 + Math.floor(i / 2), isActive: true, activeStudentCount: 32, subjectCount: 2,
  }));
  return {
    school: { educationLevel: "SMA", timezone: "WIB", checkInCloseMinute: 600, today },
    years: [{ id: "year1", name, startDate: `${year}-07-13`, endDate: `${year + 1}-06-26`, terms }],
    classes,
    subjects: [
      { id: "subject1", code: "MTK", name: "Matematika", kkm: 75, sortOrder: 1, isActive: true },
      { id: "subject2", code: "BIN", name: "Bahasa Indonesia", kkm: 75, sortOrder: 2, isActive: true },
    ],
  };
}
