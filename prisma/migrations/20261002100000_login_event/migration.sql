-- Riwayat masuk super admin (keputusan pemilik 2026-10-02: TOTP super admin dimatikan sementara; pembeda
-- pemakai akun = perangkat, IP, perkiraan lokasi & ISP). Aditif saja: satu tabel baru, tidak menyentuh tabel lama.
-- Lokasi/ISP diisi dari berkas DB-IP Lite lokal (pnpm geoip:update); kosong bila berkas belum ada.

-- CreateTable
CREATE TABLE `LoginEvent` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `succeeded` BOOLEAN NOT NULL,
    `failureCode` VARCHAR(32) NULL,
    `sessionId` VARCHAR(30) NULL,
    `platform` ENUM('ANDROID', 'IOS', 'WEB') NOT NULL,
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` VARCHAR(255) NULL,
    `deviceId` VARCHAR(100) NULL,
    `deviceName` VARCHAR(100) NULL,
    `deviceType` ENUM('MOBILE', 'TABLET', 'DESKTOP') NULL,
    `browser` VARCHAR(60) NULL,
    `os` VARCHAR(60) NULL,
    `deviceModel` VARCHAR(60) NULL,
    `isNewDevice` BOOLEAN NOT NULL DEFAULT false,
    `city` VARCHAR(100) NULL,
    `region` VARCHAR(100) NULL,
    `countryCode` CHAR(2) NULL,
    `asn` INTEGER UNSIGNED NULL,
    `isp` VARCHAR(150) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LoginEvent_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `LoginEvent_userId_deviceId_idx`(`userId`, `deviceId`),
    INDEX `LoginEvent_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LoginEvent` ADD CONSTRAINT `LoginEvent_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

