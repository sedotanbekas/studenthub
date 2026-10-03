-- Langganan Web Push (PWA) per sesi web — keputusan pemilik 2026-10-03 (N3). Aditif saja: satu tabel baru,
-- FK ke User & AuthSession ON DELETE CASCADE (sesi yang dibersihkan maintenance ikut menghapus langganannya).
-- Tidak menyentuh tabel maupun enum lama. Endpoint unik lewat hash SHA-256 (CHAR 64) karena URL push service
-- bisa sampai 2048 karakter.

-- CreateTable
CREATE TABLE `WebPushSubscription` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `endpointHash` CHAR(64) NOT NULL,
    `endpoint` VARCHAR(2048) NOT NULL,
    `p256dh` VARCHAR(128) NOT NULL,
    `auth` VARCHAR(64) NOT NULL,
    `userAgent` VARCHAR(255) NULL,
    `lastUsedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WebPushSubscription_sessionId_key`(`sessionId`),
    UNIQUE INDEX `WebPushSubscription_endpointHash_key`(`endpointHash`),
    INDEX `WebPushSubscription_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WebPushSubscription` ADD CONSTRAINT `WebPushSubscription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `WebPushSubscription` ADD CONSTRAINT `WebPushSubscription_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `AuthSession`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;
