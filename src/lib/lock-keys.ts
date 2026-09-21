/**
 * Pembentuk nama kunci aplikasi (AppLock, lihat `lockKey()` di src/lib/tx.ts) yang dipakai lintas domain.
 * Satu definisi per kunci: domain yang berbeda WAJIB memakai builder yang sama agar benar-benar saling
 * menyerialkan (string berbeda = tidak ada mutex).
 *
 * ATURAN:
 * 1. Ambil kunci aplikasi PALING AWAL di transaksi, SEBELUM membaca apa pun; baru setelah itu baca
 *    (ulang) data yang dijaga kunci. Isolasi withTx = READ COMMITTED, jadi baca sesudah kunci selalu
 *    melihat commit terakhir pemegang kunci sebelumnya.
 * 2. Bila butuh beberapa kunci aplikasi, ambil dari yang paling kasar ke paling halus sesuai urutan
 *    daftar di bawah; beberapa kunci sejenis diambil dengan id terurut naik.
 * 3. Kunci aplikasi selalu mendahului `lockRows()`/FOR UPDATE baris data (urutan kunci global di tx.ts).
 *
 * Urutan (kasar -> halus): superAdmins -> holidays -> subjects -> classYear -> class -> nisnRelease -> user.
 */

/** Mutasi yang dapat mengubah jumlah super admin aktif (cegah menonaktifkan SA terakhir). */
export const superAdminsLockKey = (): string => "super-admins";

/** Libur satu sekolah, atau libur nasional bila schoolId null (impor & CRUD). */
export const holidaysLockKey = (schoolId: string | null): string => `holidays:${schoolId ?? "national"}`;

/** Master mata pelajaran satu sekolah (kode unik & status aktif). */
export const subjectsLockKey = (schoolId: string): string => `subjects:${schoolId}`;

/** Daftar kelas dalam satu tahun ajaran (nama unik per tahun ajaran). */
export const classYearLockKey = (academicYearId: string): string => `classes:${academicYearId}`;

/**
 * Satu kelas: menyerialkan penonaktifan kelas vs penempatan/aktivasi siswa ke kelas tersebut
 * (siswa tidak boleh masuk ke kelas yang sedang/sudah dinonaktifkan).
 */
export const classLockKey = (classId: string): string => `class:${classId}`;

/** Pelepasan NISN (pemegang LULUS) yang berdampak ke sekolah asal. */
export const nisnReleaseLockKey = (schoolId: string): string => `nisn-release:${schoolId}`;

/**
 * Per user: login paralel (batas sesi & satu HP per siswa), pencabutan sesi, dan perubahan status akun.
 * Identik dengan kunci sesi auth (`userSessionLockKey` di src/lib/auth/session-service.ts).
 */
export const userLockKey = (userId: string): string => `auth:user:${userId}`;
