-- Login admin sekolah dengan NPSN (admin utama, email opsional) + "Ingat perangkat ini" 30 hari untuk
-- super admin ber-TOTP. Aditif: kolom nullable baru + tabel baru. Satu pengecualian yang DISETUJUI pemilik
-- (2026-09-30): chk_user_scope DILONGGARKAN (DROP + ADD dalam satu ALTER) agar admin utama boleh tanpa
-- email. Hanya melonggarkan: semua baris lama tetap memenuhi syarat baru dan kode lama tetap kompatibel.
-- Perbandingan memakai <=> (aman-NULL): hasil NULL pada CHECK dianggap LOLOS oleh MariaDB.

ALTER TABLE `User` ADD COLUMN `primarySchoolId` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `User_primarySchoolId_key` ON `User`(`primarySchoolId`);

CREATE TABLE `TrustedDevice` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `userAgent` VARCHAR(255) NULL,
    `ipAddress` VARCHAR(45) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `TrustedDevice_tokenHash_key`(`tokenHash`),
    INDEX `TrustedDevice_userId_idx`(`userId`),
    INDEX `TrustedDevice_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `TrustedDevice` ADD CONSTRAINT `TrustedDevice_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- Sekolah yang sudah punya admin: admin sekolah tertua (yang aktif didahulukan) menjadi admin utama,
-- sehingga langsung bisa masuk dengan NPSN sekolahnya.
UPDATE `User` u
JOIN (
  SELECT ranked.`id` FROM (
    SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `schoolId` ORDER BY `isActive` DESC, `createdAt`, `id`) AS rn
    FROM `User`
    WHERE `role` = 'SCHOOL_ADMIN' AND `schoolId` IS NOT NULL
  ) ranked
  WHERE ranked.rn = 1
) p ON p.`id` = u.`id`
SET u.`primarySchoolId` = u.`schoolId`;

ALTER TABLE `User`
  DROP CONSTRAINT `chk_user_scope`,
  ADD CONSTRAINT `chk_user_scope` CHECK (
    (
      (`role` = 'SUPER_ADMIN' AND `schoolId` IS NULL AND `sponsorId` IS NULL AND `email` IS NOT NULL)
      OR (`role` = 'SCHOOL_ADMIN' AND `schoolId` IS NOT NULL AND `sponsorId` IS NULL AND (`email` IS NOT NULL OR `primarySchoolId` <=> `schoolId`))
      OR (`role` = 'SPONSOR' AND `sponsorId` IS NOT NULL AND `schoolId` IS NULL AND `email` IS NOT NULL)
      OR (`role` = 'STUDENT' AND `schoolId` IS NOT NULL AND `sponsorId` IS NULL AND `email` IS NULL)
    )
    AND (`primarySchoolId` IS NULL OR (`role` = 'SCHOOL_ADMIN' AND `primarySchoolId` <=> `schoolId`))
  );
