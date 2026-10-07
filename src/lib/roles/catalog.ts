import type { Action } from "@/lib/auth/policy";

/**
 * Katalog hak akses RBAC (2026-10-07): nama & penjelasan setiap aksi POLICY untuk layar "Peran & hak akses".
 * `satisfies Record<Action, ...>` = aksi POLICY baru WAJIB diberi label di sini (typecheck gagal bila lupa).
 * Urutan GROUPS = urutan tampil.
 */
export const PERMISSION_GROUPS = [
  "Akun & keamanan",
  "Beranda & sekolah",
  "Siswa",
  "Absensi",
  "Izin & sakit",
  "Akademik & rapor",
  "SPP & tagihan",
  "Pengumuman & kalender",
  "Notifikasi",
  "Pengguna, peran & audit",
  "Sponsor & iklan",
  "Platform",
] as const;
export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

export interface PermissionInfo {
  readonly group: PermissionGroup;
  readonly label: string;
  readonly hint: string;
}

const p = (group: PermissionGroup, label: string, hint: string): PermissionInfo => ({ group, label, hint });

export const PERMISSION_CATALOG = {
  "auth.self": p("Akun & keamanan", "Masuk & profil sendiri", "Melihat profil, sesi perangkat, dan keluar dari akun."),
  "auth.account": p("Akun & keamanan", "Keamanan akun sendiri", "Ganti kata sandi, keluar dari semua perangkat, cabut sesi."),
  "auth.totp": p("Akun & keamanan", "Verifikasi dua langkah", "Mendaftarkan TOTP & melupakan perangkat tepercaya."),
  "auth.email": p("Akun & keamanan", "Ubah email login", "Menambah atau mengganti email login sendiri."),
  "file.read": p("Akun & keamanan", "Buka berkas", "Membuka foto & berkas yang memang boleh dilihat akun ini."),
  "region.read": p("Akun & keamanan", "Data wilayah", "Daftar provinsi/kota untuk formulir alamat & target iklan."),
  "dashboard.read": p("Beranda & sekolah", "Ringkasan beranda", "Kartu ringkasan siswa, kehadiran, rapor, dan SPP."),
  "schools.profile.read": p("Beranda & sekolah", "Lihat profil sekolah", "Identitas, jadwal, dan pengaturan sekolah."),
  "schools.settings.update": p("Beranda & sekolah", "Ubah pengaturan sekolah", "Jam absen, hari sekolah, dan pengingat absen."),
  "schools.theme.read": p("Beranda & sekolah", "Lihat tema sekolah", "Warna tema sekolah."),
  "schools.theme.update": p("Beranda & sekolah", "Ubah tema sekolah", "Mengganti warna tema untuk seluruh admin & siswa sekolah."),
  "schools.manage": p("Beranda & sekolah", "Kelola semua sekolah", "Daftarkan sekolah, lokasi & geofence, rekening SPP, aktif/nonaktif."),
  "students.read": p("Siswa", "Lihat data siswa", "Daftar & detail siswa beserta data keluarga."),
  "students.manage": p("Siswa", "Kelola siswa", "Tambah, ubah, aktifkan, pindahkan, dan reset kata sandi siswa."),
  "students.import": p("Siswa", "Impor siswa dari Excel", "Unggah templat Excel dan simpan siswa massal."),
  "students.profile.read": p("Siswa", "Biodata sendiri (siswa)", "Siswa melihat biodatanya sendiri."),
  "attendance.self": p("Absensi", "Absen masuk & pulang (siswa)", "Status hari ini, cek lokasi, absen dengan foto wajah, alasan terlambat."),
  "attendance.self.read": p("Absensi", "Riwayat absen sendiri (siswa)", "Riwayat & ringkasan kehadiran milik sendiri."),
  "attendance.monitor": p("Absensi", "Pantau kehadiran", "Monitoring harian, peta, rekap bulanan, analitik, dan percobaan ditolak."),
  "attendance.correct": p("Absensi", "Koreksi absensi", "Mengubah status kehadiran siswa secara manual."),
  "attendance.anomaly_review": p("Absensi", "Tinjau anomali absen", "Menandai absen beranomali sebagai valid / tidak valid."),
  "attendance.reclose": p("Absensi", "Tutup ulang hari sekolah", "Menjalankan ulang auto-alpha untuk hari yang sudah lewat."),
  "attendance.test_mode": p("Absensi", "Mode uji absensi", "Melonggarkan lokasi & jam absen sementara di semua sekolah."),
  "leave.self": p("Izin & sakit", "Ajukan izin/sakit (siswa)", "Mengajukan dan membatalkan izin atau sakit."),
  "leave.self.read": p("Izin & sakit", "Riwayat izin sendiri (siswa)", "Daftar pengajuan izin/sakit milik sendiri."),
  "leave.review": p("Izin & sakit", "Tinjau izin & sakit", "Menyetujui/menolak pengajuan dan input izin atas nama siswa."),
  "academics.read": p("Akademik & rapor", "Lihat data akademik", "Tahun ajaran, semester, kelas, dan mata pelajaran."),
  "academics.manage": p("Akademik & rapor", "Kelola data akademik", "Membuat & mengubah tahun ajaran, semester, kelas, mapel."),
  "reportCards.read": p("Akademik & rapor", "Lihat rapor", "Lembar nilai, daftar & detail rapor, cek kesiapan terbit."),
  "reportCards.manage": p("Akademik & rapor", "Isi nilai rapor", "Input nilai, buat rapor kosong, hapus rapor draf."),
  "reportCards.publish": p("Akademik & rapor", "Terbitkan rapor", "Menerbitkan dan menarik terbit rapor."),
  "reportCards.self.read": p("Akademik & rapor", "Rapor sendiri (siswa)", "Siswa melihat rapor terbit miliknya."),
  "billing.read": p("SPP & tagihan", "Lihat tagihan", "Daftar & detail tagihan, antrean bukti transfer, kuitansi."),
  "billing.write": p("SPP & tagihan", "Kelola tagihan", "Membuat (tunggal/massal), mengubah, membatalkan, memulihkan tagihan."),
  "billing.verify": p("SPP & tagihan", "Verifikasi pembayaran", "Menyetujui/menolak bukti transfer, catat tunai, batalkan pembayaran."),
  "billing.self.read": p("SPP & tagihan", "Tagihan sendiri (siswa)", "Tagihan, kuitansi, dan rekening SPP milik sendiri."),
  "billing.self.pay": p("SPP & tagihan", "Bayar tagihan (siswa)", "Mengunggah & membatalkan bukti transfer."),
  "announcements.read": p("Pengumuman & kalender", "Lihat pengumuman", "Daftar pengumuman sekolah."),
  "announcements.manage": p("Pengumuman & kalender", "Kelola pengumuman", "Membuat, mengubah, dan menghapus pengumuman."),
  "calendar.read": p("Pengumuman & kalender", "Lihat kalender sekolah", "Agenda & libur sekolah."),
  "calendar.manage": p("Pengumuman & kalender", "Kelola kalender sekolah", "Menambah, mengubah, menghapus agenda & libur sekolah."),
  "calendar.student.read": p("Pengumuman & kalender", "Kalender belajar (siswa)", "Siswa melihat kalender sekolahnya."),
  "calendar.national.read": p("Pengumuman & kalender", "Lihat libur nasional", "Daftar libur nasional bersama."),
  "calendar.national.manage": p("Pengumuman & kalender", "Kelola libur nasional", "Menambah & mengubah libur nasional untuk semua sekolah."),
  "notification.self": p("Notifikasi", "Kotak notifikasi", "Membaca notifikasi milik sendiri."),
  "notification.preferences": p("Notifikasi", "Pilihan kabar sekolah", "Mengatur kabar sekolah yang diterima akun ini."),
  "notification.push": p("Notifikasi", "Notifikasi HP (Web Push)", "Berlangganan notifikasi di browser/HP ini."),
  "users.manage": p("Pengguna, peran & audit", "Kelola pengguna platform", "Membuat & mengubah akun super admin dan admin sekolah."),
  "users.impersonate": p("Pengguna, peran & audit", "Masuk sebagai akun lain", "Membuka akun lain (mode lihat, 30 menit) untuk verifikasi keluhan."),
  "roles.read": p("Pengguna, peran & audit", "Lihat peran & hak akses", "Daftar peran dan hak akses (admin sekolah: peran admin sekolah saja)."),
  "roles.manage": p("Pengguna, peran & audit", "Kelola peran & hak akses", "Membuat, mengubah, menghapus peran dan memasangnya ke akun."),
  "schoolAdmins.read": p("Pengguna, peran & audit", "Lihat admin & guru", "Daftar akun admin sekolah dan guru."),
  "schoolAdmins.manage": p("Pengguna, peran & audit", "Kelola admin & guru", "Menambah, menonaktifkan, reset kata sandi admin/guru (admin utama)."),
  "audit.school.read": p("Pengguna, peran & audit", "Riwayat aktivitas sekolah", "Log audit perubahan data sekolah."),
  "audit.platform.read": p("Pengguna, peran & audit", "Audit platform", "Log audit seluruh platform."),
  "audit.login.read": p("Pengguna, peran & audit", "Riwayat masuk", "Riwayat login (perangkat, IP, perkiraan lokasi)."),
  "sponsor.self.read": p("Sponsor & iklan", "Profil & saldo sponsor", "Profil, saldo, ledger, dan riwayat top-up milik sendiri."),
  "sponsor.self.write": p("Sponsor & iklan", "Ubah profil sponsor", "Mengubah profil kontak dan membatalkan top-up menunggu."),
  "sponsor.topup": p("Sponsor & iklan", "Top-up saldo", "Mengajukan top-up saldo iklan."),
  "ads.own.read": p("Sponsor & iklan", "Lihat iklan sendiri", "Daftar & detail kampanye milik sendiri."),
  "ads.own.write": p("Sponsor & iklan", "Kelola draf iklan", "Unggah banner, buat/ubah/hapus draf, jeda, arsipkan."),
  "ads.own.submit": p("Sponsor & iklan", "Ajukan & tayangkan iklan", "Mengajukan review dan melanjutkan tayang."),
  "ads.targeting.read": p("Sponsor & iklan", "Pilih sekolah target", "Pemilih sekolah untuk target iklan."),
  "ads.analytics.read": p("Sponsor & iklan", "Analitik iklan", "Impresi, klik, dan biaya iklan."),
  "ads.serve": p("Sponsor & iklan", "Lihat slider mitra (siswa)", "Siswa melihat info mitra di beranda."),
  "ads.event": p("Sponsor & iklan", "Catat tayang & klik (siswa)", "Melaporkan impresi & klik info mitra."),
  "sponsor.admin": p("Sponsor & iklan", "Kelola sponsor & pengaturan iklan", "Akun sponsor, status, ledger, dan pengaturan platform iklan."),
  "topup.review": p("Sponsor & iklan", "Verifikasi top-up", "Menyetujui/menolak top-up saldo sponsor."),
  "ads.review": p("Sponsor & iklan", "Moderasi iklan", "Antrean review, setujui/tolak, dan turunkan iklan."),
  "platform.jobs.read": p("Platform", "Status job terjadwal", "Melihat jalannya job latar (auto-alpha, pengingat, dll.)."),
  "app.settings": p("Platform", "Nama & logo aplikasi", "Mengganti nama dan logo aplikasi di sidebar, halaman masuk, dan judul tab."),
} as const satisfies Record<Action, PermissionInfo>;
