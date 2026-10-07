import type { LateReasonValue } from "@/lib/attendance/late-reason-rules";
import type { LateReasonResultDto } from "@/lib/attendance/late-reason-schemas";
import { checkOutBlockReason } from "@/lib/attendance/check-out-rules";
import type { CheckOutResultDto, TodayDto } from "@/lib/attendance/student-schemas";
import { formatMinute, localParts } from "@/lib/time/zone";
import type { Row } from "./types";
import { demoPersona } from "./demo-personas";
import { demoAdsDetail, demoAdsRows } from "./demo-ads";
import { demoAnalyticsRows } from "./demo-analytics";
import { demoAttendanceNotices } from "./demo-notifications";
import { demoMonitorRows } from "./demo-monitor";
import { studentDemoDetail, studentDemoRows } from "./demo-student";
/** Biodata, kontak, & data keluarga demo (tampil di detail siswa admin dan profil siswa). */
const family = (n: number, address: string, [father, fatherJob]: [string, string], [mother, motherJob]: [string, string], ownPhone = true): Row => ({
  birthPlace: "Bandung", birthDate: `2010-0${n}-1${n}`, address,
  phone: ownPhone ? `+62857100000${n}0` : null,
  fatherName: father, fatherOccupation: fatherJob, fatherPhone: `+62812100000${n}0`,
  motherName: mother, motherOccupation: motherJob, motherPhone: `+62813100000${n}0`,
  guardianName: father, guardianOccupation: fatherJob, guardianPhone: `+62812100000${n}0`,
});
export const demoStudents: Row[] = [
  { id: "s1", name: "Alya Putri Ramadhani", nisn: "0098765432", nis: "2026001", gender: "FEMALE", status: "ACTIVE", class: { name: "X IPA 1" }, sppAmount: 350000, ...family(1, "Jl. Merdeka No. 12, Kota Bandung", ["Rahmat Hidayat", "Wiraswasta"], ["Siti Rahmawati", "Guru/Dosen"]) },
  { id: "s2", name: "Bima Aditya Pratama", nisn: "0098765433", nis: "2026002", gender: "MALE", status: "ACTIVE", class: { name: "X IPA 1" }, sppAmount: 350000, ...family(2, "Jl. Dago No. 45, Kota Bandung", ["Agus Pratama", "PNS/TNI/Polri"], ["Dewi Lestari", "Ibu rumah tangga"]) },
  { id: "s3", name: "Citra Ayu Lestari", nisn: "0098765434", nis: "2026003", gender: "FEMALE", status: "ACTIVE", class: { name: "XI IPS 2" }, sppAmount: 350000, ...family(3, "Jl. Cihampelas No. 8, Kota Bandung", ["Joko Susilo", "Pedagang"], ["Ayu Wulandari", "Pedagang"], false) },
  { id: "s4", name: "Daffa Rizky Saputra", nisn: "0098765435", nis: "2026004", gender: "MALE", status: "DRAFT", class: { name: "X IPA 2" }, sppAmount: 350000, ...family(4, "Jl. Setiabudi No. 21, Kota Bandung", ["Hendra Saputra", "Karyawan swasta"], ["Rina Marlina", "Tenaga kesehatan"]) },
  { id: "s5", name: "Elena Safira", nisn: "0098765436", nis: "2026005", gender: "FEMALE", status: "ACTIVE", class: { name: "XII IPA 1" }, sppAmount: 350000, ...family(5, "Jl. Riau No. 3, Kota Bandung", ["Yusuf Safari", "Petani"], ["Nur Aini", "Wiraswasta"]) },
  { id: "s6", name: "Farhan Maulana", nisn: "0098765437", nis: "2026006", gender: "MALE", status: "ACTIVE", class: { name: "XI IPA 1" }, sppAmount: 350000, ...family(6, "Jl. Buah Batu No. 17, Kota Bandung", ["Maulana Ishak", "Buruh"], ["Endang Susilowati", "Ibu rumah tangga"], false) },
];
export const demoSummary = { students: { active: 1284, draft: 12, inactive: 8, graduated: 320, moved: 3 }, attendanceToday: { present: 1198, late: 24, izin: 18, sakit: 12, alpha: 8, notYet: 24, eligible: 1284, presentPct: 95.2, isSchoolDay: true }, billing: { pendingVerification: 8, studentsNotFullyPaid: 126, outstandingAmount: 44100000, period: { collectedAmount: 405300000, billedAmount: 449400000, paid: 1158, invoiced: 1284 } }, reportCards: { published: 1080, activeStudents: 1284, studentsComplete: 1160, term: { label: "Ganjil 2026/2027" } } };
/** Siapa yang melihat data demo; persona siswa membawa `studentId` miliknya, persona apa pun membawa perannya. */
export interface DemoViewer { readonly studentId?: string; readonly identity?: { readonly user: { readonly role: string } } }
/** Jalur /student/* yang isinya bukan data pribadi (sama untuk semua siswa). */
const SHARED_STUDENT_PATHS = /^\/student\/(calendar|ads)$/;

function studentOf(viewer?: DemoViewer): Row | undefined {
  return viewer?.studentId ? demoStudents.find(s => s.id === viewer.studentId) : undefined;
}

/** Pengumuman & kotak masuk contoh (tanpa readAt = belum dibaca). */
const DEMO_INBOX: ReadonlyArray<{ id: string; title: string; body: string; status: string; createdAt: string; readAt?: string | null }> = [
  { id: "n1", title: "Bersiap untuk Penilaian Tengah Semester", body: "Penilaian Tengah Semester dimulai Senin depan. Pastikan jadwal dan perlengkapan belajar sudah siap, ya.", status: "PUBLISHED", createdAt: "2026-09-22" },
  { id: "n2", title: "Jumat bersih, sekolah lebih nyaman", body: "Mari merawat ruang belajar bersama pada Jumat pagi.", status: "PUBLISHED", createdAt: "2026-09-21" },
  { id: "n3", title: "Pertemuan orang tua dan wali siswa", body: "Undangan pertemuan orang tua siswa kelas X di aula sekolah.", status: "DRAFT", createdAt: "2026-09-20" },
];

/** Kotak masuk demo per persona: notifikasi absensi milik persona (N4) lalu pengumuman contoh. */
const demoInboxFor = (viewer?: DemoViewer): Row[] => [...demoAttendanceNotices(viewer, localParts(new Date(), "WIB").ymd), ...DEMO_INBOX];

/** Badge notifikasi demo (N1): jumlah item kotak masuk persona yang belum dibaca; tanpa permintaan jaringan. */
export const demoUnreadCount = (viewer?: DemoViewer): number => demoInboxFor(viewer).filter(n => !n.readAt).length;

/**
 * Data contoh per jalur API. Jalur /student/* hanya berisi data milik persona siswa yang sedang
 * dilihat; tanpa persona siswa -> kosong (gagal tertutup, tidak pernah data siswa lain).
 */
export function demoRows(path: string, viewer?: DemoViewer, params: Readonly<Record<string, unknown>> = {}): unknown {
  // Jalur persis milik domain iklan/sponsor & monitoring absensi dicek sebelum pencocokan longgar di bawah.
  const exact = demoAdsRows(path) ?? demoMonitorRows(path, params) ?? demoAnalyticsRows(path);
  if (exact !== undefined) return exact;
  if (path === "/notifications") return demoInboxFor(viewer);
  if (path.startsWith("/student/") && !SHARED_STUDENT_PATHS.test(path)) {
    const student = studentOf(viewer);
    return student ? studentDemoRows(path, student) : [];
  }
  return sharedRows(path);
}

/** Detail rekaman pada mode demo; untuk jalur siswa hanya bila rekaman itu milik persona. */
export function demoDetail(path: string, id: string, viewer?: DemoViewer): Row | null {
  const ad = demoAdsDetail(path, id);
  if (ad !== undefined) return ad as Row | null;
  if (!path.startsWith("/student/")) return null;
  const student = studentOf(viewer);
  return student ? studentDemoDetail(path, id, student) : null;
}

/** Pengaturan pengingat absen contoh (N5): jadwal sudah diatur (07:15), 15 menit sebelumnya. */
export const DEMO_REMINDER_SETTINGS = {
  enabled: true, leadMinutes: 15, checkInOpenMinute: 360, startMinute: 435, lateToleranceMinutes: 15, schoolDaysMask: 31, sendMinute: 420,
  timezone: "WIB", defaultSchedule: false, activeStudentCount: 1284, pushReadyStudentCount: 1012,
} as const;

/** Akun admin sekolah contoh (N2): admin utama + dua guru, satu mematikan kabar Keuangan. */
export const demoSchoolAdmins = [
  { id: "adm1", name: "Admin SMA Cendekia", email: null, loginNpsn: "20123456", isPrimary: true, isActive: true, mustChangePassword: false, tempPasswordExpiresAt: null, lastLoginAt: "2026-09-25T00:30:00.000Z", createdAt: "2026-07-01T02:00:00.000Z", mutedCategories: [], accessRole: null },
  { id: "adm2", name: "Bu Rina (Wali kelas X IPA 1)", email: "rina@cendekia.sch.id", loginNpsn: null, isPrimary: false, isActive: true, mustChangePassword: false, tempPasswordExpiresAt: null, lastLoginAt: "2026-09-24T23:50:00.000Z", createdAt: "2026-07-15T02:00:00.000Z", mutedCategories: ["FINANCE"], accessRole: { id: "demo-role-wali", name: "Wali kelas", isSystem: false } },
  { id: "adm3", name: "Pak Dodi (Guru BK)", email: "dodi@cendekia.sch.id", loginNpsn: null, isPrimary: false, isActive: true, mustChangePassword: false, tempPasswordExpiresAt: null, lastLoginAt: "2026-09-25T01:10:00.000Z", createdAt: "2026-07-15T02:05:00.000Z", mutedCategories: [], accessRole: null },
] as const;

function sharedRows(path: string): unknown {
  // Notifikasi HP (N3): aktif di server contoh; mode demo tidak pernah berlangganan (tombol menampilkan pesan demo).
  if (path === "/me/web-push") return { enabled: true, publicKey: null, subscribed: false };
  // Pengingat absen (N5) — sebelum cabang `attendance` di bawah agar tidak menjadi baris monitor.
  if (path === "/school/settings/attendance-reminder") return DEMO_REMINDER_SETTINGS;
  if (path === "/me/notification-preferences") return { mutedCategories: [], mutableCategories: ["FINANCE", "STUDENT_AFFAIRS", "ATTENDANCE"], updatedAt: null, updatedBy: null };
  if (path === "/school/admins") return demoSchoolAdmins;
  if (path === "/school/report-cards/sheet") return { term: { id: "term1", label: "Ganjil 2026/2027" }, class: { id: "c1", name: "X IPA 1" }, subject: { id: "subject1", name: "Matematika", code: "MTK", kkm: 75 }, rows: demoStudents.map((s, i) => ({ studentId: s.id, name: s.name, nis: s.nis, score: 80 + i, predicate: "B", reportCardStatus: "DRAFT", blockedReason: null })) };
  if (path === "/school/academic-years") return [{ id: "year1", name: "2026/2027", terms: [{ id: "term1", label: "Ganjil 2026/2027" }, { id: "term2", label: "Genap 2026/2027" }] }];
  if (path === "/school/subjects") return [{ id: "subject1", name: "Matematika", code: "MTK" }, { id: "subject2", name: "Bahasa Indonesia", code: "BIN" }];
  if (path.includes("students")) return demoStudents;
  if (path === "/platform/attendance/test-mode") return { enabled: false, since: null };
  if (path.includes("attendance")) return demoStudents.map((s, i) => ({ student: { ...s, className: (s.class as Row).name }, attendance: { id: `a${i}`, status: i === 3 ? "TERLAMBAT" : "HADIR", checkInTimeLocal: `06:${42 + i * 3}`, hasAnomaly: false } }));
  if (path.includes("classes")) return ["X IPA 1", "X IPA 2", "XI IPA 1", "XI IPS 2", "XII IPA 1"].map((name, i) => ({ id: `c${i}`, name, level: 10 + Math.floor(i / 2), studentCount: 32 }));
  if (path.includes("announcements") || path.includes("notifications")) return DEMO_INBOX;
  if (path.includes("invoices") || path.includes("payment-submissions")) return demoStudents.map((s, i) => ({ id: `i${i}`, invoiceNo: `INV-2026-00${i + 1}`, title: "SPP September 2026", student: s, periodMonth: 9, periodYear: 2026, amount: 350000, paidAmount: i < 3 ? 350000 : 0, remaining: i < 3 ? 0 : 350000, dueDate: "2026-09-30", status: i < 3 ? "PAID" : "UNPAID", displayStatus: i < 3 ? "LUNAS" : "BELUM_BAYAR" }));
  if (path.includes("report-cards")) return demoStudents.map((s, i) => ({ id: `r${i}`, student: s, className: (s.class as Row).name, status: i < 4 ? "PUBLISHED" : "DRAFT", gradedCount: i < 4 ? 10 : 7, expectedCount: 10, average: 82 + i, publishedAt: i < 4 ? "2026-09-24T03:00:00.000Z" : null }));
  if (path.includes("holidays") || path.includes("calendar")) return [{ id: "h1", name: "Libur semester", startDate: "2026-12-21", endDate: "2027-01-02" }];
  if (path.includes("schools")) return [{ id: "sc1", name: "SMA Cendekia Nusantara", npsn: "20123456", timezone: "WIB", isActive: true }, { id: "sc2", name: "SMP Harapan Bangsa", npsn: "20123457", timezone: "WIB", isActive: true }];
  if (path.includes("sessions")) return [{ id: "session1", deviceName: "Chrome · Windows", platform: "WEB", isCurrent: true, lastUsedAt: "2026-09-22T06:00:00Z" }];
  return [];
}
/** Status absen hari ini untuk mode demo (titik sekolah disimulasikan di sekitar pengguna saat alur berjalan). */
export const demoToday = { date: "2026-09-25", serverTime: "2026-09-25T00:10:00.000Z", timezone: "WIB", ianaTimezone: "Asia/Jakarta", schoolDay: { isSchoolDay: true, reason: "SCHOOL_DAY", holidayName: null }, window: { opensAt: "06:00", lateAfter: "07:15", closesAt: "10:00", state: "OPEN", checkOutOpensAt: "14:00" }, geofence: { radiusM: 150, maxAccuracyM: 100, latitude: -6.1754, longitude: 106.8272 }, record: null, pendingLeave: null, canCheckIn: true, blockReason: null, canCheckOut: false, checkOutBlockReason: "NOT_CHECKED_IN" } as const;
/** Absen pulang demo dibuka 14:00 WIB (sama dengan default sekolah). */
const DEMO_CHECKOUT_OPEN_MINUTE = 14 * 60;
/**
 * Status absen hari ini untuk siswa demo (tiap siswa punya kondisi berbeda). Siswa yang sudah absen masuk boleh
 * absen pulang mulai 14:00 WIB menurut jam sekarang (`now`), memakai aturan yang sama dengan server.
 */
export function demoTodayFor(key: string, now: Date = new Date()): TodayDto {
  const base = demoToday as unknown as TodayDto;
  const record = demoPersona(key).todayRecord ?? null;
  if (!record) return base;
  const checkOutBlock = checkOutBlockReason({
    record: { status: record.status, checkedIn: record.checkInTimeLocal !== null, checkOutTimeLocal: record.checkOutTimeLocal },
    day: { isSchoolDay: true, reason: "SCHOOL_DAY", holidayName: null },
    minuteOfDay: localParts(now, "WIB").minuteOfDay,
    openMinute: DEMO_CHECKOUT_OPEN_MINUTE,
    testMode: false,
  });
  return { ...base, record, canCheckIn: false, blockReason: "ALREADY_CHECKED_IN", canCheckOut: checkOutBlock === null, checkOutBlockReason: checkOutBlock };
}
/** Absen pulang pada mode demo: tanpa jaringan dan tidak tersimpan (muat ulang = hilang). */
export function demoCheckOutResult(now: Date, checkInTimeLocal: string | null): CheckOutResultDto {
  const checkOutTimeLocal = formatMinute(localParts(now, "WIB").minuteOfDay);
  return {
    attendance: { id: "demo-checkout", date: demoToday.date, status: "HADIR", checkInTimeLocal, checkOutAt: now.toISOString(), checkOutTimeLocal, checkOutDistanceM: 24 },
    message: `Mode demo: absen pulang pukul ${checkOutTimeLocal} tersimpan (simulasi) — hilang saat halaman dimuat ulang.`,
  };
}

/** Status hari ini setelah absen pulang demo (state lokal halaman). */
export function withDemoCheckOut(today: TodayDto, checkOutTimeLocal: string | null): TodayDto {
  if (!checkOutTimeLocal || !today.record) return today;
  return { ...today, record: { ...today.record, checkOutTimeLocal }, canCheckOut: false, checkOutBlockReason: "ALREADY_CHECKED_OUT" };
}

export const demoHistory = { month: "2026-09", days: ["22", "23", "24"].map((d, i) => ({ date: `2026-09-${d}`, status: i === 1 ? "TERLAMBAT" : "HADIR", source: "CHECKIN", checkInTimeLocal: i === 1 ? "07:26" : `06:4${i}`, lateMinutes: i === 1 ? 26 : null, leaveRequestId: null, checkOutTimeLocal: i === 2 ? null : `14:0${i + 3}` })), nonSchoolDays: [], summary: { recorded: 3, present: 2, late: 1, izin: 0, sakit: 0, alpha: 0, presentPct: 100 } };
/** Simpan alasan terlambat pada mode demo: tanpa jaringan dan tidak tersimpan (A1). */
export function demoSaveLateReason(body: LateReasonValue, now: Date): LateReasonResultDto {
  const lateReason = { category: body.category, note: body.note, timeLocal: formatMinute(localParts(now, "WIB").minuteOfDay), updatedAt: now.toISOString() };
  return { lateReason, unchanged: false, message: "Mode demo: alasan tersimpan (simulasi) — hilang saat halaman dimuat ulang." };
}
