import type { Row } from "./types";
export const demoStudents: Row[] = [
  { id: "s1", name: "Alya Putri Ramadhani", nisn: "0098765432", nis: "2026001", gender: "FEMALE", status: "ACTIVE", class: { name: "X IPA 1" }, sppAmount: 350000 },
  { id: "s2", name: "Bima Aditya Pratama", nisn: "0098765433", nis: "2026002", gender: "MALE", status: "ACTIVE", class: { name: "X IPA 1" }, sppAmount: 350000 },
  { id: "s3", name: "Citra Ayu Lestari", nisn: "0098765434", nis: "2026003", gender: "FEMALE", status: "ACTIVE", class: { name: "XI IPS 2" }, sppAmount: 350000 },
  { id: "s4", name: "Daffa Rizky Saputra", nisn: "0098765435", nis: "2026004", gender: "MALE", status: "DRAFT", class: { name: "X IPA 2" }, sppAmount: 350000 },
  { id: "s5", name: "Elena Safira", nisn: "0098765436", nis: "2026005", gender: "FEMALE", status: "ACTIVE", class: { name: "XII IPA 1" }, sppAmount: 350000 },
  { id: "s6", name: "Farhan Maulana", nisn: "0098765437", nis: "2026006", gender: "MALE", status: "ACTIVE", class: { name: "XI IPA 1" }, sppAmount: 350000 },
];
export const demoSummary = { students: { active: 1284, draft: 12, inactive: 8, graduated: 320, moved: 3 }, attendanceToday: { present: 1198, late: 24, izin: 18, sakit: 12, alpha: 8, notYet: 24, eligible: 1284, presentPct: 95.2, isSchoolDay: true }, billing: { pendingVerification: 8, studentsNotFullyPaid: 126, outstandingAmount: 44100000, period: { collectedAmount: 405300000, billedAmount: 449400000, paid: 1158, invoiced: 1284 } }, reportCards: { published: 1080, activeStudents: 1284, studentsComplete: 1160, term: { label: "Ganjil 2026/2027" } } };
export function demoRows(path: string): unknown {
  if (path === "/school/report-cards/sheet") return { term: { id: "term1", label: "Ganjil 2026/2027" }, class: { id: "c1", name: "X IPA 1" }, subject: { id: "subject1", name: "Matematika", code: "MTK", kkm: 75 }, rows: demoStudents.map((s, i) => ({ studentId: s.id, name: s.name, nis: s.nis, score: 80 + i, predicate: "B", reportCardStatus: "DRAFT", blockedReason: null })) };
  if (path === "/school/academic-years") return [{ id: "year1", name: "2026/2027", terms: [{ id: "term1", label: "Ganjil 2026/2027" }, { id: "term2", label: "Genap 2026/2027" }] }];
  if (path === "/school/subjects") return [{ id: "subject1", name: "Matematika", code: "MTK" }, { id: "subject2", name: "Bahasa Indonesia", code: "BIN" }];
  if (path.includes("students")) return demoStudents;
  if (path.includes("attendance")) return demoStudents.map((s, i) => ({ student: { ...s, className: (s.class as Row).name }, attendance: { id: `a${i}`, status: i === 3 ? "TERLAMBAT" : "HADIR", checkInTimeLocal: `06:${42 + i * 3}`, hasAnomaly: false } }));
  if (path.includes("classes")) return ["X IPA 1", "X IPA 2", "XI IPA 1", "XI IPS 2", "XII IPA 1"].map((name, i) => ({ id: `c${i}`, name, level: 10 + Math.floor(i / 2), studentCount: 32 }));
  if (path.includes("announcements") || path.includes("notifications")) return [{ id: "n1", title: "Bersiap untuk Penilaian Tengah Semester", body: "Penilaian Tengah Semester dimulai Senin depan. Pastikan jadwal dan perlengkapan belajar sudah siap, ya.", status: "PUBLISHED", createdAt: "2026-09-22" }, { id: "n2", title: "Jumat bersih, sekolah lebih nyaman", body: "Mari merawat ruang belajar bersama pada Jumat pagi.", status: "PUBLISHED", createdAt: "2026-09-21" }, { id: "n3", title: "Pertemuan orang tua dan wali siswa", body: "Undangan pertemuan orang tua siswa kelas X di aula sekolah.", status: "DRAFT", createdAt: "2026-09-20" }];
  if (path.includes("invoices") || path.includes("payment-submissions")) return demoStudents.map((s, i) => ({ id: `i${i}`, invoiceNo: `INV-2026-00${i + 1}`, student: s, periodMonth: 9, periodYear: 2026, amount: 350000, paidAmount: i < 3 ? 350000 : 0, dueDate: "2026-09-30", status: i < 3 ? "PAID" : "UNPAID" }));
  if (path.includes("report-cards")) return demoStudents.map((s, i) => ({ id: `r${i}`, student: s, termLabel: "Ganjil 2026/2027", status: i < 4 ? "PUBLISHED" : "DRAFT", averageScore: 82 + i }));
  if (path.includes("holidays") || path.includes("calendar")) return [{ id: "h1", name: "Libur semester", startDate: "2026-12-21", endDate: "2027-01-02" }];
  if (path.includes("schools")) return [{ id: "sc1", name: "SMA Cendekia Nusantara", npsn: "20123456", timezone: "WIB", isActive: true }, { id: "sc2", name: "SMP Harapan Bangsa", npsn: "20123457", timezone: "WIB", isActive: true }];
  if (path.includes("sessions")) return [{ id: "session1", deviceName: "Chrome · Windows", platform: "WEB", isCurrent: true, lastUsedAt: "2026-09-22T06:00:00Z" }];
  if (path.includes("balance")) return { balance: 2450000, totalTopUp: 5000000 };
  if (path.includes("ads")) return [{ id: "ad1", title: "Buka pintu masa depanmu", status: "APPROVED", impressions: 12480, clicks: 326 }, { id: "ad2", title: "Belajar lebih menyenangkan", status: "DRAFT", impressions: 0, clicks: 0 }];
  return [];
}
/** Status absen hari ini untuk mode demo (titik sekolah disimulasikan di sekitar pengguna saat alur berjalan). */
export const demoToday = { date: "2026-09-25", serverTime: "2026-09-25T00:10:00.000Z", timezone: "WIB", ianaTimezone: "Asia/Jakarta", schoolDay: { isSchoolDay: true, reason: "SCHOOL_DAY", holidayName: null }, window: { opensAt: "06:00", lateAfter: "07:15", closesAt: "10:00", state: "OPEN" }, geofence: { radiusM: 150, maxAccuracyM: 100, latitude: -6.1754, longitude: 106.8272 }, record: null, pendingLeave: null, canCheckIn: true, blockReason: null } as const;
export const demoHistory = { month: "2026-09", days: ["22", "23", "24"].map((d, i) => ({ date: `2026-09-${d}`, status: i === 1 ? "TERLAMBAT" : "HADIR", source: "CHECKIN", checkInTimeLocal: i === 1 ? "07:26" : `06:4${i}`, lateMinutes: i === 1 ? 26 : null, leaveRequestId: null })), nonSchoolDays: [], summary: { recorded: 3, present: 2, late: 1, izin: 0, sakit: 0, alpha: 0, presentPct: 100 } };
