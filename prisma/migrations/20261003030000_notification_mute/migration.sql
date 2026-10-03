-- Kategori kabar sekolah per akun admin (keputusan pemilik 2026-10-03, N2). Aditif saja: satu tabel baru, tidak
-- menyentuh tabel lama. Satu baris = satu kategori siaran admin yang DIMATIKAN untuk satu akun; akun tanpa baris
-- menerima semua (perilaku lama, tanpa backfill). Kategori SYSTEM (perubahan pengaturan/rekening sekolah, NISN
-- dilepas) tidak pernah boleh dimatikan. Daftar ENUM disalin dari definisi NotificationCategory terakhir
-- (20260921000000_init); bila kategori kelak bertambah (di UJUNG), kolom ini ikut di-MODIFY bersama Notification
-- & Announcement. Kolom kiri PK melayani indeks FK userId.

-- CreateTable
CREATE TABLE `NotificationMute` (
    `userId` VARCHAR(191) NOT NULL,
    `category` ENUM('ACADEMIC', 'FINANCE', 'EVENT', 'CALENDAR', 'STUDENT_AFFAIRS', 'SYSTEM') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`userId`, `category`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `NotificationMute` ADD CONSTRAINT `NotificationMute_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- SYSTEM selalu dikirim (dijaga juga oleh zod & rules.ts).
ALTER TABLE `NotificationMute` ADD CONSTRAINT `chk_notification_mute_category` CHECK (`category` <> 'SYSTEM');
