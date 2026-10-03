-- Pengingat absen (keputusan pemilik 2026-10-03, N5). Aditif saja:
-- 1) dua kolom School ber-DEFAULT (instan) + CHECK chk_school_reminder_lead (5..120 menit; tabel School kecil);
--    default menyala 15 menit, tetapi job TIDAK mengirim untuk sekolah yang jadwalnya masih bawaan (belum diatur);
-- 2) kolom nullable Notification.pushExpiresAt (instan): push yang belum terkirim tidak dikirim lagi setelah waktu ini;
-- 3) nilai NotificationType ATTENDANCE_REMINDER DI UJUNG daftar (daftar disalin PERSIS dari 20261003040000);
-- 4) indeks (type, createdAt) online untuk retensi pendek tipe push-only.

ALTER TABLE `School` ADD COLUMN `attendanceReminderEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `attendanceReminderLeadMinutes` SMALLINT NOT NULL DEFAULT 15,
    ALGORITHM=INSTANT;

ALTER TABLE `School` ADD CONSTRAINT `chk_school_reminder_lead` CHECK (`attendanceReminderLeadMinutes` BETWEEN 5 AND 120);

ALTER TABLE `Notification` ADD COLUMN `pushExpiresAt` DATETIME(3) NULL, ALGORITHM=INSTANT;

ALTER TABLE `Notification` MODIFY `type` ENUM('ANNOUNCEMENT', 'INVOICE_ISSUED', 'PAYMENT_SUBMITTED', 'PAYMENT_APPROVED', 'PAYMENT_REJECTED', 'LEAVE_SUBMITTED', 'LEAVE_APPROVED', 'LEAVE_REJECTED', 'REPORT_CARD_PUBLISHED', 'SPONSOR_APPROVED', 'SPONSOR_SUSPENDED', 'AD_SUBMITTED', 'AD_APPROVED', 'AD_REJECTED', 'TOPUP_SUBMITTED', 'TOPUP_APPROVED', 'TOPUP_REJECTED', 'LOW_BALANCE', 'ATTENDANCE_CORRECTED', 'INVOICE_VOIDED', 'PAYMENT_VOIDED', 'NISN_RELEASED', 'SCHOOL_SETTINGS_CHANGED', 'ATTENDANCE_ALPHA', 'ATTENDANCE_DAY_SUMMARY', 'ATTENDANCE_REMINDER') NOT NULL, ALGORITHM=INSTANT;

ALTER TABLE `Notification` ADD INDEX `Notification_type_createdAt_idx`(`type`, `createdAt`), ALGORITHM=INPLACE, LOCK=NONE;
