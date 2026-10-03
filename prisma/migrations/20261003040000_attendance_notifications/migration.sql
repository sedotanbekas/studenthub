-- Notifikasi peristiwa absensi (keputusan pemilik 2026-10-03, N4). Aditif saja:
-- 1) dua nilai NotificationType DI UJUNG daftar (ATTENDANCE_ALPHA untuk siswa, ATTENDANCE_DAY_SUMMARY untuk admin);
-- 2) satu nilai NotificationCategory DI UJUNG daftar (ATTENDANCE "Kehadiran") di ketiga kolom kategori:
--    Notification, Announcement (pengumuman tetap dibatasi zod ke kategori lama), dan NotificationMute (CHECK
--    chk_notification_mute_category tidak berubah: hanya SYSTEM yang dilarang);
-- 3) kolom nullable `dedupKey` + indeks unik (userId, dedupKey): notifikasi Alpa per tanggal & rekap harian tepat
--    sekali per penerima walau hari ditutup ulang. NULL tidak saling bentrok di indeks unik, jadi notifikasi lama &
--    tipe lain tidak terpengaruh.
-- Daftar ENUM disalin PERSIS dari definisi terakhir (20260921000000_init; NotificationMute: 20261003030000) lalu
-- ditambah di ujung — perluasan ENUM di ujung = INSTANT. Indeks dibangun online (INPLACE, LOCK=NONE) agar tabel
-- Notification yang besar tidak pernah jatuh ke COPY diam-diam.
-- Rollback kode setelah baris tipe baru ada: DELETE FROM Notification WHERE type IN ('ATTENDANCE_ALPHA',
-- 'ATTENDANCE_DAY_SUMMARY') OR category = 'ATTENDANCE' lebih dulu (klien Prisma lama tidak mengenal nilainya).

ALTER TABLE `Notification` MODIFY `type` ENUM('ANNOUNCEMENT', 'INVOICE_ISSUED', 'PAYMENT_SUBMITTED', 'PAYMENT_APPROVED', 'PAYMENT_REJECTED', 'LEAVE_SUBMITTED', 'LEAVE_APPROVED', 'LEAVE_REJECTED', 'REPORT_CARD_PUBLISHED', 'SPONSOR_APPROVED', 'SPONSOR_SUSPENDED', 'AD_SUBMITTED', 'AD_APPROVED', 'AD_REJECTED', 'TOPUP_SUBMITTED', 'TOPUP_APPROVED', 'TOPUP_REJECTED', 'LOW_BALANCE', 'ATTENDANCE_CORRECTED', 'INVOICE_VOIDED', 'PAYMENT_VOIDED', 'NISN_RELEASED', 'SCHOOL_SETTINGS_CHANGED', 'ATTENDANCE_ALPHA', 'ATTENDANCE_DAY_SUMMARY') NOT NULL,
    MODIFY `category` ENUM('ACADEMIC', 'FINANCE', 'EVENT', 'CALENDAR', 'STUDENT_AFFAIRS', 'SYSTEM', 'ATTENDANCE') NOT NULL,
    ALGORITHM=INSTANT;

ALTER TABLE `Announcement` MODIFY `category` ENUM('ACADEMIC', 'FINANCE', 'EVENT', 'CALENDAR', 'STUDENT_AFFAIRS', 'SYSTEM', 'ATTENDANCE') NOT NULL, ALGORITHM=INSTANT;

ALTER TABLE `NotificationMute` MODIFY `category` ENUM('ACADEMIC', 'FINANCE', 'EVENT', 'CALENDAR', 'STUDENT_AFFAIRS', 'SYSTEM', 'ATTENDANCE') NOT NULL, ALGORITHM=INSTANT;

ALTER TABLE `Notification` ADD COLUMN `dedupKey` VARCHAR(64) NULL, ALGORITHM=INSTANT;

ALTER TABLE `Notification` ADD UNIQUE INDEX `Notification_userId_dedupKey_key`(`userId`, `dedupKey`), ALGORITHM=INPLACE, LOCK=NONE;
