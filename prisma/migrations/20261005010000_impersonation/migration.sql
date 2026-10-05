-- "Masuk sebagai" (pemilik 2026-10-05): super admin membuka akun lain (selain super admin) dalam sesi terpisah 30 menit.
-- Aditif: kolom nullable baru + indeks + FK; baris lama tetap valid (NULL = sesi login biasa / tindakan pemilik akun).

-- AlterTable
ALTER TABLE `AuditLog` ADD COLUMN `impersonatorId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `AuthSession` ADD COLUMN `impersonatorId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `AuthSession_impersonatorId_idx` ON `AuthSession`(`impersonatorId`);

-- AddForeignKey
ALTER TABLE `AuthSession` ADD CONSTRAINT `AuthSession_impersonatorId_fkey` FOREIGN KEY (`impersonatorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;
