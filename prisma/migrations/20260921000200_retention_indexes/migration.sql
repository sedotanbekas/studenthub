-- Migrasi aditif: indeks retensi job maintenance-daily. Tanpa indeks ini pembersihan Notification
-- (createdAt < tenggat) dan AuthSession (revokedAt < tenggat) memindai SELURUH tabel setiap hari.
-- CREATE INDEX InnoDB berjalan online (ALGORITHM=INPLACE, LOCK=NONE) tanpa mengunci tulis.

-- CreateIndex
CREATE INDEX `Notification_createdAt_idx` ON `Notification`(`createdAt`);

-- CreateIndex
CREATE INDEX `AuthSession_revokedAt_idx` ON `AuthSession`(`revokedAt`);
