import type { Module, Role } from "./types";
const moduleOf = (key: string, title: string, description: string, icon: string, group: string, paths: string[], primary?: string): Module => ({ key, title, description, icon, group, paths, primary });
const school: Module[] = [
  moduleOf("students", "Data siswa", "Setiap siswa, satu tempat untuk tumbuh.", "users", "SEKOLAH", ["/school/students"], "listSchoolStudents"),
  moduleOf("attendance", "Kehadiran", "Pantau kehadiran dan mulai hari dengan lebih tenang.", "check", "SEKOLAH", ["/school/attendance", "/school/leave-requests"], "monitorAttendanceDaily"),
  moduleOf("academics", "Akademik", "Susun tahun ajaran, kelas, dan mata pelajaran.", "book", "SEKOLAH", ["/school/academic-years", "/school/terms", "/school/active-term", "/school/classes", "/school/subjects"], "listSchoolClasses"),
  moduleOf("reports", "Rapor siswa", "Catat proses belajar. Rayakan setiap kemajuan.", "report", "SEKOLAH", ["/school/report-cards"], "listReportCards"),
  moduleOf("billing", "Tagihan & pembayaran", "Kelola SPP dan verifikasi pembayaran dengan mudah.", "wallet", "MANAJEMEN", ["/school/invoices", "/school/payment-submissions", "/school/payments"], "listSchoolInvoices"),
  // Analitik SPP per lingkup (2026-10-07): super admin (semua), Admin Pemda (wilayahnya), admin sekolah (sekolahnya).
  moduleOf("spp-analytics", "Analitik SPP", "Lunas tepat waktu, telat, dan tunggakan per wilayah, sekolah, kelas, dan siswa.", "chart", "MANAJEMEN", ["/analytics/spp"], "getSppAnalytics"),
  moduleOf("announcements", "Pengumuman", "Informasi yang tepat, untuk semua yang membutuhkan.", "megaphone", "MANAJEMEN", ["/school/announcements"], "listSchoolAnnouncements"),
  moduleOf("calendar", "Kalender sekolah", "Rencanakan hari belajar dan hari libur bersama.", "calendar", "MANAJEMEN", ["/school/holidays"], "listSchoolHolidays"),
  moduleOf("school-admins", "Admin & guru", "Akun masuk untuk guru dan wali kelas yang ikut mengelola sekolah.", "key", "MANAJEMEN", ["/school/admins"], "listSchoolAdmins"),
  moduleOf("school-settings", "Pengaturan sekolah", "Profil, jadwal kehadiran, dan kesiapan sekolah.", "settings", "LAINNYA", ["/school/profile", "/school/settings"], "getSchoolProfile"),
  moduleOf("school-theme", "Tema sekolah", "Warna aplikasi sesuai identitas sekolahmu.", "palette", "LAINNYA", ["/school/theme"], "getSchoolTheme"),
  moduleOf("audit", "Riwayat aktivitas", "Jejak perubahan untuk pengelolaan yang transparan.", "history", "LAINNYA", ["/school/audit-logs"], "listSchoolAuditLogs"),
];
const platform: Module[] = [
  moduleOf("schools", "Sekolah", "Hubungkan sekolah dan bangun ekosistem pendidikan.", "school", "PLATFORM", ["/platform/schools"], "listPlatformSchools"),
  moduleOf("users", "Pengguna", "Semua akun per sekolah: ID login, status kata sandi, dan riwayat masuk.", "users", "PLATFORM", ["/platform/users"], "listPlatformUsers"),
  moduleOf("sponsors", "Sponsor", "Kelola mitra dan persetujuan sponsor.", "heart", "PLATFORM", ["/platform/sponsors"], "listSponsors"),
  moduleOf("ad-review", "Moderasi iklan", "Tinjau konten sebelum menjangkau siswa.", "image", "PLATFORM", ["/platform/ads"], "listPlatformAds"),
  moduleOf("topups", "Verifikasi top-up", "Tinjau bukti transfer dan pengisian saldo sponsor.", "wallet", "PLATFORM", ["/platform/topups"], "listPlatformTopUps"),
  moduleOf("national-calendar", "Libur nasional", "Satu kalender bersama untuk seluruh sekolah.", "calendar", "PLATFORM", ["/platform/holidays"], "listNationalHolidays"),
  // "App Setting" (pemilik 2026-10-07): semua pengaturan platform dalam satu menu -- identitas aplikasi + iklan + absensi.
  moduleOf("platform-settings", "Pengaturan aplikasi", "Nama & logo aplikasi, tarif iklan, rekening top-up, dan penutupan absensi.", "settings", "LAINNYA", ["/platform/app-settings", "/platform/settings", "/platform/attendance"], "getAppSettings"),
  moduleOf("platform-audit", "Audit platform", "Telusuri aktivitas pengelolaan platform.", "history", "LAINNYA", ["/platform/audit-logs"], "listPlatformAuditLogs"),
  moduleOf("login-history", "Riwayat masuk", "Siapa yang masuk ke akun mana pun: perangkat, IP, perkiraan lokasi, dan alasan gagal.", "key", "LAINNYA", ["/platform/login-history"], "listLoginHistory"),
  moduleOf("access-roles", "Peran & hak akses", "Atur peran, centang hak akses tiap fitur, dan pasang peran ke akun.", "shield", "LAINNYA", ["/access-roles"], "listAccessRoles"),
];
/** Admin Pemda (REGION_ADMIN, 2026-10-07): sekolah di wilayahnya, lalu modul sekolah BACA saja lewat pemilih sekolah. */
const region: Module[] = [
  moduleOf("region-schools", "Sekolah wilayah", "Sekolah di provinsi/kota wilayah Anda beserta ringkasannya.", "school", "WILAYAH", ["/region/schools"], "listRegionSchools"),
];
const sponsor: Module[] = [
  moduleOf("campaigns", "Kampanye saya", "Ide baik layak menjangkau lebih banyak orang.", "megaphone", "SPONSOR", ["/sponsor/ads", "/sponsor/banners", "/sponsor/targeting"], "listOwnAds"),
  moduleOf("analytics", "Analitik", "Pahami jangkauan dan performa kampanye Anda.", "chart", "SPONSOR", ["/sponsor/analytics"], "getAdAnalyticsSummary"),
  moduleOf("balance", "Saldo & top-up", "Pantau saldo, pengisian, dan riwayat transaksi.", "wallet", "SPONSOR", ["/sponsor/balance", "/sponsor/topups", "/sponsor/ledger"], "getOwnSponsorBalance"),
  moduleOf("company", "Profil perusahaan", "Lengkapi informasi dan kontak perusahaan.", "school", "LAINNYA", ["/sponsor/profile"], "getOwnSponsorProfile"),
];
const student: Module[] = [
  moduleOf("my-attendance", "Absensi", "Absen masuk dengan lokasi dan foto wajah dari HP.", "location", "RUANG SISWA", ["/student/attendance"], "getOwnAttendanceToday"),
  moduleOf("my-leave", "Izin & sakit", "Ajukan izin atau sakit beserta lampirannya.", "calendar", "RUANG SISWA", ["/student/leave-requests"], "listOwnLeaveRequests"),
  moduleOf("my-reports", "Rapor saya", "Lihat hasil belajar dan perkembanganmu.", "report", "RUANG SISWA", ["/student/report-cards"], "listOwnReportCards"),
  moduleOf("my-billing", "Tagihan saya", "Lihat tagihan, kirim bukti bayar, dan unduh kuitansi.", "wallet", "RUANG SISWA", ["/student/invoices", "/student/payment-submissions", "/student/payments", "/student/payment-info"], "listOwnInvoices"),
  moduleOf("my-calendar", "Kalender belajar", "Lihat hari belajar dan libur sekolahmu.", "calendar", "RUANG SISWA", ["/student/calendar"], "getStudentCalendar"),
  moduleOf("my-profile", "Profil saya", "Informasi diri dan data sekolahmu.", "users", "LAINNYA", ["/student/profile"], "getOwnStudentProfile"),
];
const common: Module[] = [
  moduleOf("notifications", "Notifikasi", "Semua kabar terbaru, tersimpan di sini.", "bell", "LAINNYA", ["/notifications"], "listNotifications"),
  moduleOf("security", "Keamanan akun", "Kelola kata sandi, autentikasi, dan perangkat aktif.", "shield", "LAINNYA", ["/auth/change-password", "/auth/logout-all", "/me/sessions"], "listMySessions"),
  // /me/totp sengaja tidak di menu: TOTP super admin mati sejak 2026-10-02 (SUPER_ADMIN_TOTP); bila dinyalakan,
  // pendaftaran wajib tampil lewat kartu TotpTask di Keamanan akun (security-panel.tsx).
];
/**
 * Aksi POLICY yang membuka tiap modul (= aksi operasi `primary`, dijaga modules.test.ts terhadap catalog.json).
 * RBAC (2026-10-07): modul tampil hanya bila peran akses akun memegang aksinya (Identity.permissions).
 */
export const MODULE_ACTIONS: Readonly<Record<string, string>> = {
  students: "students.read", attendance: "attendance.monitor", academics: "academics.read", reports: "reportCards.read",
  billing: "billing.read", announcements: "announcements.read", calendar: "calendar.read", "school-admins": "schoolAdmins.read",
  "school-settings": "schools.profile.read", "school-theme": "schools.theme.read", audit: "audit.school.read",
  schools: "schools.manage", users: "users.manage", sponsors: "sponsor.admin", "ad-review": "ads.review", topups: "topup.review",
  "national-calendar": "calendar.national.read", "platform-settings": "app.settings", "platform-audit": "audit.platform.read",
  "login-history": "audit.login.read", "access-roles": "roles.read", "region-schools": "region.monitor", "spp-analytics": "billing.read",
  campaigns: "ads.own.read", analytics: "ads.analytics.read", balance: "sponsor.self.read", company: "sponsor.self.read",
  "my-attendance": "attendance.self", "my-leave": "leave.self.read", "my-reports": "reportCards.self.read", "my-billing": "billing.self.read",
  "my-calendar": "calendar.student.read", "my-profile": "students.profile.read",
  notifications: "notification.self", security: "auth.self",
};
/**
 * Modul gabungan: tampil juga bila akun hanya memegang hak bagian lain di dalamnya (mis. peran yang hanya boleh
 * mengatur iklan tetap melihat Pengaturan aplikasi, tanpa kartu nama & logo).
 */
export const MODULE_ALT_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  "platform-settings": ["sponsor.admin", "attendance.reclose", "attendance.test_mode"],
};
/**
 * permissions tidak dikirim / kosong (test lama, persona demo) = semua modul jenis akun. Akun sungguhan tidak
 * pernah kosong: auth.self selalu terkunci tercentang (src/lib/roles/rules.ts ALWAYS_GRANTED).
 */
const permitted = (permissions: readonly string[] | undefined) => (m: Module) =>
  !permissions?.length || [MODULE_ACTIONS[m.key] ?? "", ...(MODULE_ALT_ACTIONS[m.key] ?? [])].some(action => permissions.includes(action));
export function modulesFor(role: Role, permissions?: readonly string[]): Module[] {
  return [...baseModules(role), ...common].filter(permitted(permissions));
}
function baseModules(role: Role): Module[] {
  if (role === "SUPER_ADMIN") return [...platform, ...school];
  if (role === "REGION_ADMIN") return [...region, ...school];
  return role === "SPONSOR" ? sponsor : role === "STUDENT" ? student : school;
}
/** Akun yang memilih sekolah lewat pemilih di atas halaman (super admin: semua sekolah; Admin Pemda: sekolah wilayahnya). */
export const picksSchool = (role: Role): boolean => role === "SUPER_ADMIN" || role === "REGION_ADMIN";
/** Bagian hub dari pathname: /hub -> "dashboard", /hub/x/... -> "x". */
export function sectionFromPath(pathname: string): string {
  return pathname.split("/").filter(Boolean)[1] ?? "dashboard";
}
/** Halaman detail di dalam bagian: /hub/x/<id> -> id (mis. detail sekolah); selain itu null. */
export function sectionDetailId(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 3 || !parts[2]) return null;
  try { return decodeURIComponent(parts[2]); } catch { return null; }
}
const ALL_SECTION_KEYS = new Set(["dashboard", ...[...platform, ...region, ...school, ...sponsor, ...student, ...common].map(m => m.key)]);
/** Bagian yang ada untuk salah satu peran (URL asal-asalan tetap "tidak ditemukan"). */
export function isKnownSection(section: string): boolean {
  return ALL_SECTION_KEYS.has(section);
}
/** Akun terbatas: wajib ganti kata sandi awal atau wajib daftar TOTP sebelum memakai fitur lain. */
export function isRestricted(identity: { user: { mustChangePassword: boolean; totpEnrollmentRequired: boolean } }): boolean {
  return identity.user.mustChangePassword || identity.user.totpEnrollmentRequired;
}
/** Beranda selalu boleh; selain itu hanya modul milik peran tersebut (URL peran lain -> kembali ke beranda). */
export function sectionAllowed(role: Role, section: string, permissions?: readonly string[]): boolean {
  return section === "dashboard" || modulesFor(role, permissions).some(m => m.key === section);
}
/** Halaman yang ditampilkan: akun terbatas (wajib ganti sandi/TOTP) selalu ke "Keamanan akun". */
export function resolveSection(role: Role, restricted: boolean, section: string, permissions?: readonly string[]): { home: boolean; module: Module | undefined } {
  const key = restricted ? "security" : section;
  // Akun terbatas selalu ke Keamanan akun (tanpa saringan hak: wajib ganti sandi/TOTP).
  return { home: !restricted && section === "dashboard", module: key === "dashboard" ? undefined : modulesFor(role, restricted ? undefined : permissions).find(m => m.key === key) };
}

export interface TabItem { readonly key: string; readonly label: string; readonly icon: string; readonly href: string }
/** Tujuan utama tab bar HP per peran (selain beranda); sisanya lewat tombol Menu. */
const TAB_KEYS: Record<Role, readonly [string, string][]> = {
  STUDENT: [["my-attendance", "Absensi"], ["my-reports", "Rapor"], ["my-billing", "Tagihan"]],
  SCHOOL_ADMIN: [["students", "Siswa"], ["attendance", "Kehadiran"], ["billing", "Tagihan"]],
  SPONSOR: [["campaigns", "Kampanye"], ["analytics", "Analitik"], ["balance", "Saldo"]],
  SUPER_ADMIN: [["schools", "Sekolah"], ["users", "Pengguna"], ["sponsors", "Sponsor"]],
  REGION_ADMIN: [["region-schools", "Sekolah"], ["spp-analytics", "SPP"], ["attendance", "Kehadiran"]],
};
export function tabItems(role: Role, permissions?: readonly string[]): TabItem[] {
  const modules = modulesFor(role, permissions);
  const tabs = TAB_KEYS[role].flatMap(([key, label]) => { const m = modules.find(x => x.key === key); return m ? [{ key, label, icon: m.icon, href: `/hub/${key}` }] : []; });
  return [{ key: "dashboard", label: "Beranda", icon: "grid", href: "/hub" }, ...tabs];
}
export const roleLabels: Record<Role, string> = { SCHOOL_ADMIN: "Admin sekolah", SUPER_ADMIN: "Super admin", SPONSOR: "Sponsor", STUDENT: "Siswa", REGION_ADMIN: "Admin Pemda" };
