-- Migrasi aditif: penanda bukti transfer identik/mirip dihitung SEKALI saat bukti diunggah.
-- Sebelumnya antrean/detail/approve/reject admin memuat hingga 5.000 hash bukti sekolah dan
-- membandingkannya di Node untuk setiap baris (memblokir event loop, respons tanpa batas, dan
-- jendela 365 hari menyusut di sekolah besar). Dengan tabel tepi ini pembacaan cukup lookup ber-index.
-- Tabel baru saja (tanpa DROP/MODIFY pada tabel terpakai). Pengajuan lama tanpa baris = tanpa penanda.

-- CreateTable
CREATE TABLE `PaymentProofMatch` (
    `submissionId` VARCHAR(191) NOT NULL,
    `matchSubmissionId` VARCHAR(191) NOT NULL,
    `tier` TINYINT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PaymentProofMatch_matchSubmissionId_idx`(`matchSubmissionId`),
    PRIMARY KEY (`submissionId`, `matchSubmissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PaymentProofMatch` ADD CONSTRAINT `PaymentProofMatch_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `PaymentSubmission`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `PaymentProofMatch` ADD CONSTRAINT `PaymentProofMatch_matchSubmissionId_fkey` FOREIGN KEY (`matchSubmissionId`) REFERENCES `PaymentSubmission`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 0 = sha256 identik, 1 = dHash mirip siswa sama, 2 = dHash mirip siswa lain; tidak menunjuk diri sendiri.
ALTER TABLE `PaymentProofMatch` ADD CONSTRAINT `chk_payment_proof_match` CHECK (`tier` BETWEEN 0 AND 2 AND `submissionId` <> `matchSubmissionId`);
