-- CreateTable
CREATE TABLE `Attendance` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NULL,
    `date` DATE NOT NULL,
    `status` ENUM('HADIR', 'TERLAMBAT', 'IZIN', 'SAKIT', 'ALPHA') NOT NULL,
    `source` ENUM('CHECKIN', 'LEAVE', 'AUTO_ALPHA', 'ADMIN') NOT NULL,
    `checkInAt` DATETIME(3) NULL,
    `lateMinutes` SMALLINT NULL,
    `latitude` DECIMAL(10, 7) NULL,
    `longitude` DECIMAL(10, 7) NULL,
    `accuracyM` INTEGER NULL,
    `distanceM` INTEGER NULL,
    `isMocked` BOOLEAN NULL,
    `locationCapturedAt` DATETIME(3) NULL,
    `deviceId` VARCHAR(100) NULL,
    `selfieFileId` VARCHAR(191) NULL,
    `hasAnomaly` BOOLEAN NOT NULL DEFAULT false,
    `anomalyFlags` JSON NULL,
    `leaveRequestId` VARCHAR(191) NULL,
    `note` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Attendance_selfieFileId_key`(`selfieFileId`),
    INDEX `Attendance_schoolId_date_classId_status_idx`(`schoolId`, `date`, `classId`, `status`),
    INDEX `Attendance_schoolId_hasAnomaly_date_idx`(`schoolId`, `hasAnomaly`, `date`),
    INDEX `Attendance_schoolId_date_deviceId_idx`(`schoolId`, `date`, `deviceId`),
    INDEX `Attendance_classId_date_idx`(`classId`, `date`),
    INDEX `Attendance_leaveRequestId_idx`(`leaveRequestId`),
    UNIQUE INDEX `Attendance_studentId_date_key`(`studentId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CheckInRejection` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `reason` ENUM('OUTSIDE_GEOFENCE', 'GPS_ACCURACY_TOO_LOW', 'MOCK_LOCATION', 'LOCATION_STALE', 'INVALID_LOCATION') NOT NULL,
    `latitude` DECIMAL(10, 7) NULL,
    `longitude` DECIMAL(10, 7) NULL,
    `accuracyM` INTEGER NULL,
    `distanceM` INTEGER NULL,
    `isMocked` BOOLEAN NULL,
    `deviceId` VARCHAR(100) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CheckInRejection_schoolId_date_idx`(`schoolId`, `date`),
    INDEX `CheckInRejection_studentId_createdAt_idx`(`studentId`, `createdAt`),
    INDEX `CheckInRejection_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaveRequest` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `type` ENUM('IZIN', 'SAKIT') NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `attachmentFileId` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `LeaveRequest_attachmentFileId_key`(`attachmentFileId`),
    INDEX `LeaveRequest_schoolId_status_createdAt_idx`(`schoolId`, `status`, `createdAt`),
    INDEX `LeaveRequest_schoolId_status_startDate_idx`(`schoolId`, `status`, `startDate`),
    INDEX `LeaveRequest_studentId_startDate_idx`(`studentId`, `startDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `role` ENUM('SUPER_ADMIN', 'SCHOOL_ADMIN', 'SPONSOR', 'STUDENT') NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(191) NULL,
    `passwordHash` VARCHAR(100) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `sponsorId` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT false,
    `tempPasswordExpiresAt` DATETIME(3) NULL,
    `passwordChangedAt` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `totpSecretEnc` VARCHAR(255) NULL,
    `totpEnabledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    INDEX `User_schoolId_role_isActive_idx`(`schoolId`, `role`, `isActive`),
    INDEX `User_role_isActive_idx`(`role`, `isActive`),
    INDEX `User_sponsorId_idx`(`sponsorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuthSession` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `platform` ENUM('ANDROID', 'IOS', 'WEB') NOT NULL,
    `deviceId` VARCHAR(100) NULL,
    `deviceName` VARCHAR(100) NULL,
    `expoPushToken` VARCHAR(255) NULL,
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` VARCHAR(255) NULL,
    `lastUsedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `revokeReason` ENUM('LOGOUT', 'TOKEN_REUSE', 'PASSWORD_CHANGED', 'ACCOUNT_DISABLED', 'ADMIN_REVOKED', 'REPLACED') NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AuthSession_expoPushToken_key`(`expoPushToken`),
    INDEX `AuthSession_userId_revokedAt_idx`(`userId`, `revokedAt`),
    INDEX `AuthSession_deviceId_revokedAt_idx`(`deviceId`, `revokedAt`),
    INDEX `AuthSession_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RefreshToken` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `rotatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RefreshToken_tokenHash_key`(`tokenHash`),
    INDEX `RefreshToken_sessionId_idx`(`sessionId`),
    INDEX `RefreshToken_rotatedAt_idx`(`rotatedAt`),
    INDEX `RefreshToken_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Invoice` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `invoiceNo` VARCHAR(20) NOT NULL,
    `type` ENUM('SPP') NOT NULL DEFAULT 'SPP',
    `periodYear` SMALLINT NOT NULL,
    `periodMonth` TINYINT NOT NULL,
    `title` VARCHAR(100) NOT NULL,
    `amount` INTEGER NOT NULL,
    `dueDate` DATE NOT NULL,
    `paidAmount` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('UNPAID', 'PARTIAL', 'PAID', 'VOID') NOT NULL DEFAULT 'UNPAID',
    `paidAt` DATETIME(3) NULL,
    `note` VARCHAR(255) NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidedById` VARCHAR(191) NULL,
    `voidReason` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Invoice_schoolId_status_dueDate_idx`(`schoolId`, `status`, `dueDate`),
    INDEX `Invoice_schoolId_periodYear_periodMonth_idx`(`schoolId`, `periodYear`, `periodMonth`),
    INDEX `Invoice_studentId_status_idx`(`studentId`, `status`),
    UNIQUE INDEX `Invoice_studentId_type_periodYear_periodMonth_key`(`studentId`, `type`, `periodYear`, `periodMonth`),
    UNIQUE INDEX `Invoice_schoolId_invoiceNo_key`(`schoolId`, `invoiceNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentSubmission` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `transferDate` DATE NOT NULL,
    `senderName` VARCHAR(100) NULL,
    `senderBank` VARCHAR(50) NULL,
    `proofFileId` VARCHAR(191) NOT NULL,
    `note` VARCHAR(255) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `pendingInvoiceId` VARCHAR(191) NULL,
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PaymentSubmission_proofFileId_key`(`proofFileId`),
    UNIQUE INDEX `PaymentSubmission_pendingInvoiceId_key`(`pendingInvoiceId`),
    INDEX `PaymentSubmission_schoolId_status_createdAt_idx`(`schoolId`, `status`, `createdAt`),
    INDEX `PaymentSubmission_invoiceId_status_idx`(`invoiceId`, `status`),
    INDEX `PaymentSubmission_studentId_createdAt_idx`(`studentId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Payment` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `receiptNo` VARCHAR(20) NOT NULL,
    `amount` INTEGER NOT NULL,
    `method` ENUM('TRANSFER', 'CASH') NOT NULL,
    `paidDate` DATE NOT NULL,
    `submissionId` VARCHAR(191) NULL,
    `recordedById` VARCHAR(191) NOT NULL,
    `note` VARCHAR(255) NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidedById` VARCHAR(191) NULL,
    `voidReason` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Payment_submissionId_key`(`submissionId`),
    INDEX `Payment_schoolId_paidDate_idx`(`schoolId`, `paidDate`),
    INDEX `Payment_invoiceId_idx`(`invoiceId`),
    UNIQUE INDEX `Payment_schoolId_receiptNo_key`(`schoolId`, `receiptNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocumentCounter` (
    `schoolId` VARCHAR(191) NOT NULL,
    `kind` ENUM('INVOICE', 'RECEIPT') NOT NULL,
    `year` SMALLINT NOT NULL,
    `lastValue` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`schoolId`, `kind`, `year`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Announcement` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `category` ENUM('ACADEMIC', 'FINANCE', 'EVENT', 'CALENDAR', 'STUDENT_AFFAIRS', 'SYSTEM') NOT NULL,
    `title` VARCHAR(150) NOT NULL,
    `body` TEXT NOT NULL,
    `audience` ENUM('ALL', 'CLASSES', 'STUDENTS') NOT NULL,
    `status` ENUM('DRAFT', 'PUBLISHED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `publishedAt` DATETIME(3) NULL,
    `recipientCount` INTEGER NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Announcement_schoolId_createdAt_idx`(`schoolId`, `createdAt`),
    INDEX `Announcement_schoolId_status_createdAt_idx`(`schoolId`, `status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AnnouncementTarget` (
    `id` VARCHAR(191) NOT NULL,
    `announcementId` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NULL,
    `studentId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AnnouncementTarget_classId_idx`(`classId`),
    INDEX `AnnouncementTarget_studentId_idx`(`studentId`),
    UNIQUE INDEX `AnnouncementTarget_announcementId_classId_key`(`announcementId`, `classId`),
    UNIQUE INDEX `AnnouncementTarget_announcementId_studentId_key`(`announcementId`, `studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('ANNOUNCEMENT', 'INVOICE_ISSUED', 'PAYMENT_SUBMITTED', 'PAYMENT_APPROVED', 'PAYMENT_REJECTED', 'LEAVE_SUBMITTED', 'LEAVE_APPROVED', 'LEAVE_REJECTED', 'REPORT_CARD_PUBLISHED', 'SPONSOR_APPROVED', 'SPONSOR_SUSPENDED', 'AD_SUBMITTED', 'AD_APPROVED', 'AD_REJECTED', 'TOPUP_SUBMITTED', 'TOPUP_APPROVED', 'TOPUP_REJECTED', 'LOW_BALANCE', 'ATTENDANCE_CORRECTED', 'INVOICE_VOIDED', 'PAYMENT_VOIDED', 'NISN_RELEASED', 'SCHOOL_SETTINGS_CHANGED') NOT NULL,
    `category` ENUM('ACADEMIC', 'FINANCE', 'EVENT', 'CALENDAR', 'STUDENT_AFFAIRS', 'SYSTEM') NOT NULL,
    `title` VARCHAR(150) NOT NULL,
    `body` VARCHAR(500) NOT NULL,
    `data` JSON NULL,
    `announcementId` VARCHAR(191) NULL,
    `readAt` DATETIME(3) NULL,
    `pushStatus` ENUM('PENDING', 'SENT', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `pushAttempts` TINYINT NOT NULL DEFAULT 0,
    `pushNextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `pushedAt` DATETIME(3) NULL,
    `pushError` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Notification_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `Notification_userId_type_createdAt_idx`(`userId`, `type`, `createdAt`),
    INDEX `Notification_userId_readAt_idx`(`userId`, `readAt`),
    INDEX `Notification_pushStatus_pushNextAttemptAt_idx`(`pushStatus`, `pushNextAttemptAt`),
    INDEX `Notification_announcementId_idx`(`announcementId`),
    UNIQUE INDEX `Notification_userId_announcementId_key`(`userId`, `announcementId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlatformSetting` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `defaultCpcAmount` INTEGER NOT NULL,
    `minTopUpAmount` INTEGER NOT NULL,
    `topUpBankName` VARCHAR(50) NULL,
    `topUpAccountNumber` VARCHAR(30) NULL,
    `topUpAccountHolder` VARCHAR(100) NULL,
    `deepLinkSchemes` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoredFile` (
    `id` VARCHAR(191) NOT NULL,
    `kind` ENUM('AD_BANNER', 'ATTENDANCE_SELFIE', 'PAYMENT_PROOF', 'TOPUP_PROOF', 'LEAVE_ATTACHMENT') NOT NULL,
    `storageKey` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `phash` CHAR(16) NULL,
    `width` SMALLINT NULL,
    `height` SMALLINT NULL,
    `originalName` VARCHAR(255) NULL,
    `schoolId` VARCHAR(191) NULL,
    `sponsorId` VARCHAR(191) NULL,
    `uploadedById` VARCHAR(191) NOT NULL,
    `attachedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `StoredFile_storageKey_key`(`storageKey`),
    INDEX `StoredFile_schoolId_kind_createdAt_idx`(`schoolId`, `kind`, `createdAt`),
    INDEX `StoredFile_sponsorId_kind_idx`(`sponsorId`, `kind`),
    INDEX `StoredFile_uploadedById_kind_createdAt_idx`(`uploadedById`, `kind`, `createdAt`),
    INDEX `StoredFile_sha256_idx`(`sha256`),
    INDEX `StoredFile_kind_attachedAt_createdAt_idx`(`kind`, `attachedAt`, `createdAt`),
    INDEX `StoredFile_kind_deletedAt_createdAt_idx`(`kind`, `deletedAt`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `actorRole` ENUM('SUPER_ADMIN', 'SCHOOL_ADMIN', 'SPONSOR', 'STUDENT') NULL,
    `schoolId` VARCHAR(191) NULL,
    `action` VARCHAR(64) NOT NULL,
    `entityType` VARCHAR(40) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_entityType_entityId_createdAt_idx`(`entityType`, `entityId`, `createdAt`),
    INDEX `AuditLog_schoolId_createdAt_idx`(`schoolId`, `createdAt`),
    INDEX `AuditLog_actorId_createdAt_idx`(`actorId`, `createdAt`),
    INDEX `AuditLog_action_createdAt_idx`(`action`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JobRun` (
    `id` VARCHAR(191) NOT NULL,
    `job` VARCHAR(64) NOT NULL,
    `scopeKey` VARCHAR(64) NOT NULL,
    `runKey` VARCHAR(32) NOT NULL,
    `status` ENUM('RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL,
    `attempts` TINYINT NOT NULL DEFAULT 1,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `result` JSON NULL,
    `error` TEXT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `JobRun_job_startedAt_idx`(`job`, `startedAt`),
    INDEX `JobRun_status_startedAt_idx`(`status`, `startedAt`),
    UNIQUE INDEX `JobRun_job_scopeKey_runKey_key`(`job`, `scopeKey`, `runKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppLock` (
    `key` VARCHAR(191) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReportCard` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `termId` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NOT NULL,
    `classNameSnapshot` VARCHAR(50) NOT NULL,
    `status` ENUM('DRAFT', 'PUBLISHED') NOT NULL DEFAULT 'DRAFT',
    `publishedAt` DATETIME(3) NULL,
    `publishedById` VARCHAR(191) NULL,
    `sickDays` SMALLINT NULL,
    `permitDays` SMALLINT NULL,
    `absentDays` SMALLINT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ReportCard_schoolId_termId_status_idx`(`schoolId`, `termId`, `status`),
    INDEX `ReportCard_classId_termId_idx`(`classId`, `termId`),
    UNIQUE INDEX `ReportCard_studentId_termId_key`(`studentId`, `termId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReportCardGrade` (
    `id` VARCHAR(191) NOT NULL,
    `reportCardId` VARCHAR(191) NOT NULL,
    `subjectId` VARCHAR(191) NOT NULL,
    `subjectNameSnapshot` VARCHAR(100) NOT NULL,
    `kkmSnapshot` TINYINT NOT NULL,
    `score` TINYINT UNSIGNED NOT NULL,
    `predicate` ENUM('A', 'B', 'C', 'D') NOT NULL,
    `description` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ReportCardGrade_subjectId_idx`(`subjectId`),
    UNIQUE INDEX `ReportCardGrade_reportCardId_subjectId_key`(`reportCardId`, `subjectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Province` (
    `code` VARCHAR(2) NOT NULL,
    `name` VARCHAR(100) NOT NULL,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `City` (
    `code` VARCHAR(5) NOT NULL,
    `provinceCode` VARCHAR(2) NOT NULL,
    `name` VARCHAR(100) NOT NULL,

    INDEX `City_provinceCode_idx`(`provinceCode`),
    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `School` (
    `id` VARCHAR(191) NOT NULL,
    `npsn` CHAR(8) NULL,
    `name` VARCHAR(150) NOT NULL,
    `address` TEXT NULL,
    `provinceCode` VARCHAR(2) NOT NULL,
    `cityCode` VARCHAR(5) NOT NULL,
    `latitude` DECIMAL(10, 7) NOT NULL,
    `longitude` DECIMAL(10, 7) NOT NULL,
    `geofenceRadiusM` SMALLINT NOT NULL DEFAULT 150,
    `geofenceUpdatedAt` DATETIME(3) NULL,
    `timezone` ENUM('WIB', 'WITA', 'WIT') NOT NULL DEFAULT 'WIB',
    `checkInOpenMinute` SMALLINT NOT NULL DEFAULT 360,
    `startMinute` SMALLINT NOT NULL DEFAULT 420,
    `lateToleranceMinutes` SMALLINT NOT NULL DEFAULT 15,
    `checkInCloseMinute` SMALLINT NOT NULL DEFAULT 600,
    `dayEndMinute` SMALLINT NOT NULL DEFAULT 900,
    `schoolDaysMask` TINYINT NOT NULL DEFAULT 31,
    `bankName` VARCHAR(50) NULL,
    `bankAccountNumber` VARCHAR(30) NULL,
    `bankAccountHolder` VARCHAR(100) NULL,
    `bankChangedAt` DATETIME(3) NULL,
    `activeTermId` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `School_npsn_key`(`npsn`),
    UNIQUE INDEX `School_activeTermId_key`(`activeTermId`),
    INDEX `School_provinceCode_cityCode_idx`(`provinceCode`, `cityCode`),
    INDEX `School_cityCode_idx`(`cityCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Holiday` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `name` VARCHAR(150) NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Holiday_schoolId_startDate_idx`(`schoolId`, `startDate`),
    INDEX `Holiday_startDate_idx`(`startDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AcademicYear` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(9) NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AcademicYear_schoolId_name_key`(`schoolId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Term` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `academicYearId` VARCHAR(191) NOT NULL,
    `semester` ENUM('GANJIL', 'GENAP') NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Term_schoolId_startDate_idx`(`schoolId`, `startDate`),
    UNIQUE INDEX `Term_academicYearId_semester_key`(`academicYearId`, `semester`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SchoolClass` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `academicYearId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `gradeLevel` TINYINT NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SchoolClass_schoolId_academicYearId_idx`(`schoolId`, `academicYearId`),
    UNIQUE INDEX `SchoolClass_academicYearId_name_key`(`academicYearId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Subject` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `kkm` TINYINT NOT NULL DEFAULT 75,
    `sortOrder` SMALLINT NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Subject_schoolId_code_key`(`schoolId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClassSubject` (
    `classId` VARCHAR(191) NOT NULL,
    `subjectId` VARCHAR(191) NOT NULL,
    `sortOrder` SMALLINT NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ClassSubject_subjectId_idx`(`subjectId`),
    PRIMARY KEY (`classId`, `subjectId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Sponsor` (
    `id` VARCHAR(191) NOT NULL,
    `companyName` VARCHAR(150) NOT NULL,
    `contactName` VARCHAR(100) NOT NULL,
    `contactEmail` VARCHAR(191) NOT NULL,
    `contactPhone` VARCHAR(20) NOT NULL,
    `address` TEXT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'SUSPENDED') NOT NULL DEFAULT 'PENDING',
    `statusReason` VARCHAR(255) NULL,
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `balance` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Sponsor_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Ad` (
    `id` VARCHAR(191) NOT NULL,
    `sponsorId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(100) NOT NULL,
    `imageFileId` VARCHAR(191) NOT NULL,
    `publicImageKey` VARCHAR(255) NULL,
    `targetUrl` VARCHAR(2000) NOT NULL,
    `linkType` ENUM('EXTERNAL_URL', 'DEEP_LINK') NOT NULL,
    `startAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NOT NULL,
    `status` ENUM('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'PAUSED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `targetScope` ENUM('ALL', 'PROVINCE', 'CITY', 'SCHOOL') NOT NULL DEFAULT 'ALL',
    `cpcAmount` INTEGER NOT NULL,
    `submittedAt` DATETIME(3) NULL,
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Ad_sponsorId_status_idx`(`sponsorId`, `status`),
    INDEX `Ad_status_startAt_endAt_idx`(`status`, `startAt`, `endAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdTarget` (
    `id` VARCHAR(191) NOT NULL,
    `adId` VARCHAR(191) NOT NULL,
    `provinceCode` VARCHAR(2) NULL,
    `cityCode` VARCHAR(5) NULL,
    `schoolId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AdTarget_provinceCode_idx`(`provinceCode`),
    INDEX `AdTarget_cityCode_idx`(`cityCode`),
    INDEX `AdTarget_schoolId_idx`(`schoolId`),
    UNIQUE INDEX `AdTarget_adId_provinceCode_key`(`adId`, `provinceCode`),
    UNIQUE INDEX `AdTarget_adId_cityCode_key`(`adId`, `cityCode`),
    UNIQUE INDEX `AdTarget_adId_schoolId_key`(`adId`, `schoolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdClick` (
    `id` VARCHAR(191) NOT NULL,
    `adId` VARCHAR(191) NOT NULL,
    `sponsorId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `provinceCode` VARCHAR(2) NOT NULL,
    `cityCode` VARCHAR(5) NOT NULL,
    `deviceType` ENUM('MOBILE', 'TABLET', 'DESKTOP') NOT NULL,
    `date` DATE NOT NULL,
    `billing` ENUM('CHARGED', 'DUPLICATE', 'INSUFFICIENT_BALANCE', 'AD_NOT_LIVE', 'SUSPECT') NOT NULL,
    `chargeAmount` INTEGER NOT NULL DEFAULT 0,
    `billableDate` DATE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AdClick_adId_date_userId_idx`(`adId`, `date`, `userId`),
    INDEX `AdClick_sponsorId_date_userId_idx`(`sponsorId`, `date`, `userId`),
    INDEX `AdClick_sponsorId_date_deviceType_idx`(`sponsorId`, `date`, `deviceType`),
    INDEX `AdClick_sponsorId_date_provinceCode_idx`(`sponsorId`, `date`, `provinceCode`),
    UNIQUE INDEX `AdClick_adId_userId_billableDate_key`(`adId`, `userId`, `billableDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdDailyStat` (
    `adId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `sponsorId` VARCHAR(191) NOT NULL,
    `impressions` INTEGER NOT NULL DEFAULT 0,
    `clicks` INTEGER NOT NULL DEFAULT 0,
    `uniqueClicks` INTEGER NOT NULL DEFAULT 0,
    `chargedClicks` INTEGER NOT NULL DEFAULT 0,
    `spend` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AdDailyStat_sponsorId_date_idx`(`sponsorId`, `date`),
    PRIMARY KEY (`adId`, `date`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SponsorLedgerEntry` (
    `id` VARCHAR(191) NOT NULL,
    `sponsorId` VARCHAR(191) NOT NULL,
    `seq` INTEGER NOT NULL,
    `type` ENUM('TOPUP', 'CLICK_CHARGE', 'ADJUSTMENT') NOT NULL,
    `amount` INTEGER NOT NULL,
    `balanceAfter` INTEGER NOT NULL,
    `topUpRequestId` VARCHAR(191) NULL,
    `adClickId` VARCHAR(191) NULL,
    `note` VARCHAR(255) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SponsorLedgerEntry_topUpRequestId_key`(`topUpRequestId`),
    UNIQUE INDEX `SponsorLedgerEntry_adClickId_key`(`adClickId`),
    INDEX `SponsorLedgerEntry_sponsorId_createdAt_idx`(`sponsorId`, `createdAt`),
    INDEX `SponsorLedgerEntry_sponsorId_type_createdAt_idx`(`sponsorId`, `type`, `createdAt`),
    UNIQUE INDEX `SponsorLedgerEntry_sponsorId_seq_key`(`sponsorId`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TopUpRequest` (
    `id` VARCHAR(191) NOT NULL,
    `sponsorId` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `transferDate` DATE NOT NULL,
    `senderName` VARCHAR(100) NOT NULL,
    `senderBank` VARCHAR(50) NOT NULL,
    `proofFileId` VARCHAR(191) NOT NULL,
    `note` VARCHAR(255) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TopUpRequest_proofFileId_key`(`proofFileId`),
    INDEX `TopUpRequest_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `TopUpRequest_sponsorId_createdAt_idx`(`sponsorId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Student` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `nisn` CHAR(10) NOT NULL,
    `activeNisn` CHAR(10) NULL,
    `nis` VARCHAR(20) NOT NULL,
    `gender` ENUM('MALE', 'FEMALE') NOT NULL,
    `birthPlace` VARCHAR(100) NULL,
    `birthDate` DATE NULL,
    `address` TEXT NULL,
    `guardianName` VARCHAR(100) NULL,
    `guardianPhone` VARCHAR(20) NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'INACTIVE', 'GRADUATED', 'MOVED') NOT NULL DEFAULT 'DRAFT',
    `currentClassId` VARCHAR(191) NULL,
    `activatedAt` DATETIME(3) NULL,
    `sppAmount` INTEGER NULL,
    `boundDeviceId` VARCHAR(100) NULL,
    `deviceBoundAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Student_userId_key`(`userId`),
    UNIQUE INDEX `Student_activeNisn_key`(`activeNisn`),
    INDEX `Student_nisn_idx`(`nisn`),
    INDEX `Student_schoolId_status_idx`(`schoolId`, `status`),
    INDEX `Student_currentClassId_status_idx`(`currentClassId`, `status`),
    UNIQUE INDEX `Student_schoolId_nisn_key`(`schoolId`, `nisn`),
    UNIQUE INDEX `Student_schoolId_nis_key`(`schoolId`, `nis`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Attendance` ADD CONSTRAINT `Attendance_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Attendance` ADD CONSTRAINT `Attendance_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `Student`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Attendance` ADD CONSTRAINT `Attendance_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `SchoolClass`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Attendance` ADD CONSTRAINT `Attendance_selfieFileId_fkey` FOREIGN KEY (`selfieFileId`) REFERENCES `StoredFile`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Attendance` ADD CONSTRAINT `Attendance_leaveRequestId_fkey` FOREIGN KEY (`leaveRequestId`) REFERENCES `LeaveRequest`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `CheckInRejection` ADD CONSTRAINT `CheckInRejection_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `CheckInRejection` ADD CONSTRAINT `CheckInRejection_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `Student`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `LeaveRequest` ADD CONSTRAINT `LeaveRequest_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `LeaveRequest` ADD CONSTRAINT `LeaveRequest_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `Student`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `LeaveRequest` ADD CONSTRAINT `LeaveRequest_attachmentFileId_fkey` FOREIGN KEY (`attachmentFileId`) REFERENCES `StoredFile`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `LeaveRequest` ADD CONSTRAINT `LeaveRequest_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_sponsorId_fkey` FOREIGN KEY (`sponsorId`) REFERENCES `Sponsor`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `AuthSession` ADD CONSTRAINT `AuthSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `RefreshToken` ADD CONSTRAINT `RefreshToken_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `AuthSession`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `Student`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_voidedById_fkey` FOREIGN KEY (`voidedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `PaymentSubmission` ADD CONSTRAINT `PaymentSubmission_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `PaymentSubmission` ADD CONSTRAINT `PaymentSubmission_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `PaymentSubmission` ADD CONSTRAINT `PaymentSubmission_pendingInvoiceId_fkey` FOREIGN KEY (`pendingInvoiceId`) REFERENCES `Invoice`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `PaymentSubmission` ADD CONSTRAINT `PaymentSubmission_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `Student`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `PaymentSubmission` ADD CONSTRAINT `PaymentSubmission_proofFileId_fkey` FOREIGN KEY (`proofFileId`) REFERENCES `StoredFile`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `PaymentSubmission` ADD CONSTRAINT `PaymentSubmission_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `PaymentSubmission`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_recordedById_fkey` FOREIGN KEY (`recordedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_voidedById_fkey` FOREIGN KEY (`voidedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `DocumentCounter` ADD CONSTRAINT `DocumentCounter_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Announcement` ADD CONSTRAINT `Announcement_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Announcement` ADD CONSTRAINT `Announcement_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `AnnouncementTarget` ADD CONSTRAINT `AnnouncementTarget_announcementId_fkey` FOREIGN KEY (`announcementId`) REFERENCES `Announcement`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `AnnouncementTarget` ADD CONSTRAINT `AnnouncementTarget_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `SchoolClass`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `AnnouncementTarget` ADD CONSTRAINT `AnnouncementTarget_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `Student`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_announcementId_fkey` FOREIGN KEY (`announcementId`) REFERENCES `Announcement`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `StoredFile` ADD CONSTRAINT `StoredFile_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `StoredFile` ADD CONSTRAINT `StoredFile_sponsorId_fkey` FOREIGN KEY (`sponsorId`) REFERENCES `Sponsor`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `StoredFile` ADD CONSTRAINT `StoredFile_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ReportCard` ADD CONSTRAINT `ReportCard_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ReportCard` ADD CONSTRAINT `ReportCard_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `Student`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ReportCard` ADD CONSTRAINT `ReportCard_termId_fkey` FOREIGN KEY (`termId`) REFERENCES `Term`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ReportCard` ADD CONSTRAINT `ReportCard_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `SchoolClass`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ReportCard` ADD CONSTRAINT `ReportCard_publishedById_fkey` FOREIGN KEY (`publishedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ReportCardGrade` ADD CONSTRAINT `ReportCardGrade_reportCardId_fkey` FOREIGN KEY (`reportCardId`) REFERENCES `ReportCard`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ReportCardGrade` ADD CONSTRAINT `ReportCardGrade_subjectId_fkey` FOREIGN KEY (`subjectId`) REFERENCES `Subject`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `City` ADD CONSTRAINT `City_provinceCode_fkey` FOREIGN KEY (`provinceCode`) REFERENCES `Province`(`code`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `School` ADD CONSTRAINT `School_provinceCode_fkey` FOREIGN KEY (`provinceCode`) REFERENCES `Province`(`code`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `School` ADD CONSTRAINT `School_cityCode_fkey` FOREIGN KEY (`cityCode`) REFERENCES `City`(`code`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `School` ADD CONSTRAINT `School_activeTermId_fkey` FOREIGN KEY (`activeTermId`) REFERENCES `Term`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Holiday` ADD CONSTRAINT `Holiday_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `AcademicYear` ADD CONSTRAINT `AcademicYear_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Term` ADD CONSTRAINT `Term_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Term` ADD CONSTRAINT `Term_academicYearId_fkey` FOREIGN KEY (`academicYearId`) REFERENCES `AcademicYear`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `SchoolClass` ADD CONSTRAINT `SchoolClass_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `SchoolClass` ADD CONSTRAINT `SchoolClass_academicYearId_fkey` FOREIGN KEY (`academicYearId`) REFERENCES `AcademicYear`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Subject` ADD CONSTRAINT `Subject_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ClassSubject` ADD CONSTRAINT `ClassSubject_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `SchoolClass`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ClassSubject` ADD CONSTRAINT `ClassSubject_subjectId_fkey` FOREIGN KEY (`subjectId`) REFERENCES `Subject`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Sponsor` ADD CONSTRAINT `Sponsor_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Ad` ADD CONSTRAINT `Ad_sponsorId_fkey` FOREIGN KEY (`sponsorId`) REFERENCES `Sponsor`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Ad` ADD CONSTRAINT `Ad_imageFileId_fkey` FOREIGN KEY (`imageFileId`) REFERENCES `StoredFile`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Ad` ADD CONSTRAINT `Ad_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `AdTarget` ADD CONSTRAINT `AdTarget_adId_fkey` FOREIGN KEY (`adId`) REFERENCES `Ad`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `AdTarget` ADD CONSTRAINT `AdTarget_provinceCode_fkey` FOREIGN KEY (`provinceCode`) REFERENCES `Province`(`code`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `AdTarget` ADD CONSTRAINT `AdTarget_cityCode_fkey` FOREIGN KEY (`cityCode`) REFERENCES `City`(`code`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `AdTarget` ADD CONSTRAINT `AdTarget_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `AdClick` ADD CONSTRAINT `AdClick_adId_fkey` FOREIGN KEY (`adId`) REFERENCES `Ad`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `AdClick` ADD CONSTRAINT `AdClick_sponsorId_fkey` FOREIGN KEY (`sponsorId`) REFERENCES `Sponsor`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `AdClick` ADD CONSTRAINT `AdClick_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `AdClick` ADD CONSTRAINT `AdClick_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `AdDailyStat` ADD CONSTRAINT `AdDailyStat_adId_fkey` FOREIGN KEY (`adId`) REFERENCES `Ad`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `AdDailyStat` ADD CONSTRAINT `AdDailyStat_sponsorId_fkey` FOREIGN KEY (`sponsorId`) REFERENCES `Sponsor`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `SponsorLedgerEntry` ADD CONSTRAINT `SponsorLedgerEntry_sponsorId_fkey` FOREIGN KEY (`sponsorId`) REFERENCES `Sponsor`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `SponsorLedgerEntry` ADD CONSTRAINT `SponsorLedgerEntry_topUpRequestId_fkey` FOREIGN KEY (`topUpRequestId`) REFERENCES `TopUpRequest`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `SponsorLedgerEntry` ADD CONSTRAINT `SponsorLedgerEntry_adClickId_fkey` FOREIGN KEY (`adClickId`) REFERENCES `AdClick`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `SponsorLedgerEntry` ADD CONSTRAINT `SponsorLedgerEntry_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `TopUpRequest` ADD CONSTRAINT `TopUpRequest_sponsorId_fkey` FOREIGN KEY (`sponsorId`) REFERENCES `Sponsor`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `TopUpRequest` ADD CONSTRAINT `TopUpRequest_proofFileId_fkey` FOREIGN KEY (`proofFileId`) REFERENCES `StoredFile`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `TopUpRequest` ADD CONSTRAINT `TopUpRequest_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Student` ADD CONSTRAINT `Student_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Student` ADD CONSTRAINT `Student_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Student` ADD CONSTRAINT `Student_currentClassId_fkey` FOREIGN KEY (`currentClassId`) REFERENCES `SchoolClass`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ============================================================
-- CHECK constraint: invarian bisnis dijaga juga oleh basis data (MariaDB 10.11).
-- Setiap constraint punya test integrasi di tests/integration/platform/check-constraints.test.ts.
-- ============================================================

ALTER TABLE `User` ADD CONSTRAINT `chk_user_scope` CHECK (
  (`role` = 'SUPER_ADMIN' AND `schoolId` IS NULL AND `sponsorId` IS NULL AND `email` IS NOT NULL)
  OR (`role` = 'SCHOOL_ADMIN' AND `schoolId` IS NOT NULL AND `sponsorId` IS NULL AND `email` IS NOT NULL)
  OR (`role` = 'SPONSOR' AND `sponsorId` IS NOT NULL AND `schoolId` IS NULL AND `email` IS NOT NULL)
  OR (`role` = 'STUDENT' AND `schoolId` IS NOT NULL AND `sponsorId` IS NULL AND `email` IS NULL)
);

ALTER TABLE `School` ADD CONSTRAINT `chk_school_schedule` CHECK (
  `checkInOpenMinute` >= 0 AND `checkInOpenMinute` < `startMinute`
  AND `startMinute` <= `checkInCloseMinute` AND `checkInCloseMinute` <= `dayEndMinute`
  AND `dayEndMinute` < 1440 AND `startMinute` + `lateToleranceMinutes` < `checkInCloseMinute`
);
ALTER TABLE `School` ADD CONSTRAINT `chk_school_radius` CHECK (`geofenceRadiusM` BETWEEN 50 AND 1000);
ALTER TABLE `School` ADD CONSTRAINT `chk_school_tolerance` CHECK (`lateToleranceMinutes` BETWEEN 0 AND 120);
ALTER TABLE `School` ADD CONSTRAINT `chk_school_days` CHECK (`schoolDaysMask` BETWEEN 1 AND 127);
ALTER TABLE `School` ADD CONSTRAINT `chk_school_bank` CHECK (
  (`bankName` IS NULL AND `bankAccountNumber` IS NULL AND `bankAccountHolder` IS NULL)
  OR (`bankName` IS NOT NULL AND `bankAccountNumber` IS NOT NULL AND `bankAccountHolder` IS NOT NULL)
);

ALTER TABLE `Holiday` ADD CONSTRAINT `chk_holiday_range` CHECK (`startDate` <= `endDate`);
ALTER TABLE `AcademicYear` ADD CONSTRAINT `chk_academic_year_range` CHECK (`startDate` < `endDate`);
ALTER TABLE `Term` ADD CONSTRAINT `chk_term_range` CHECK (`startDate` < `endDate`);
ALTER TABLE `Subject` ADD CONSTRAINT `chk_subject_kkm` CHECK (`kkm` BETWEEN 0 AND 100);
ALTER TABLE `SchoolClass` ADD CONSTRAINT `chk_class_grade_level` CHECK (`gradeLevel` BETWEEN 1 AND 12);

ALTER TABLE `Student` ADD CONSTRAINT `chk_student_spp` CHECK (`sppAmount` IS NULL OR `sppAmount` BETWEEN 0 AND 50000000);
ALTER TABLE `Student` ADD CONSTRAINT `chk_student_active_nisn` CHECK (
  (`activeNisn` IS NULL OR `activeNisn` = `nisn`)
  AND (`status` NOT IN ('DRAFT', 'MOVED') OR `activeNisn` IS NULL)
  AND (`status` NOT IN ('ACTIVE', 'INACTIVE') OR `activeNisn` IS NOT NULL)
);

ALTER TABLE `ReportCardGrade` ADD CONSTRAINT `chk_grade_score` CHECK (`score` <= 100 AND `kkmSnapshot` BETWEEN 0 AND 100);

ALTER TABLE `Attendance` ADD CONSTRAINT `chk_attendance_checkin` CHECK (
  `source` <> 'CHECKIN'
  OR (`checkInAt` IS NOT NULL AND `latitude` IS NOT NULL AND `longitude` IS NOT NULL AND `selfieFileId` IS NOT NULL)
);
ALTER TABLE `Attendance` ADD CONSTRAINT `chk_attendance_auto_alpha` CHECK (`source` <> 'AUTO_ALPHA' OR `status` = 'ALPHA');
ALTER TABLE `Attendance` ADD CONSTRAINT `chk_attendance_leave` CHECK (
  `source` <> 'LEAVE' OR (`status` IN ('IZIN', 'SAKIT') AND `leaveRequestId` IS NOT NULL)
);
ALTER TABLE `Attendance` ADD CONSTRAINT `chk_attendance_late` CHECK (
  (`status` = 'TERLAMBAT' AND `lateMinutes` IS NOT NULL AND `lateMinutes` BETWEEN 1 AND 720)
  OR (`status` <> 'TERLAMBAT' AND `lateMinutes` IS NULL)
);
ALTER TABLE `LeaveRequest` ADD CONSTRAINT `chk_leave_range` CHECK (
  `startDate` <= `endDate` AND DATEDIFF(`endDate`, `startDate`) <= 30
);

ALTER TABLE `Invoice` ADD CONSTRAINT `chk_invoice_amounts` CHECK (
  `amount` > 0 AND `paidAmount` >= 0 AND `paidAmount` <= `amount` AND `periodMonth` BETWEEN 1 AND 12
);
ALTER TABLE `Invoice` ADD CONSTRAINT `chk_invoice_status` CHECK (
  (`status` = 'UNPAID' AND `paidAmount` = 0)
  OR (`status` = 'PARTIAL' AND `paidAmount` > 0 AND `paidAmount` < `amount`)
  OR (`status` = 'PAID' AND `paidAmount` = `amount`)
  OR (`status` = 'VOID' AND `paidAmount` = 0)
);
ALTER TABLE `PaymentSubmission` ADD CONSTRAINT `chk_submission_amount` CHECK (`amount` > 0);
ALTER TABLE `PaymentSubmission` ADD CONSTRAINT `chk_submission_pending` CHECK (
  ((`status` = 'PENDING') = (`pendingInvoiceId` IS NOT NULL))
  AND (`pendingInvoiceId` IS NULL OR `pendingInvoiceId` = `invoiceId`)
);
ALTER TABLE `Payment` ADD CONSTRAINT `chk_payment_amount` CHECK (`amount` > 0);
ALTER TABLE `DocumentCounter` ADD CONSTRAINT `chk_document_counter` CHECK (`lastValue` >= 0);

ALTER TABLE `AnnouncementTarget` ADD CONSTRAINT `chk_announcement_target_one` CHECK (
  (`classId` IS NOT NULL) + (`studentId` IS NOT NULL) = 1
);

ALTER TABLE `Sponsor` ADD CONSTRAINT `chk_sponsor_balance` CHECK (`balance` >= 0);
ALTER TABLE `Ad` ADD CONSTRAINT `chk_ad_cpc` CHECK (`cpcAmount` BETWEEN 100 AND 100000);
ALTER TABLE `Ad` ADD CONSTRAINT `chk_ad_schedule` CHECK (`startAt` < `endAt`);
ALTER TABLE `AdTarget` ADD CONSTRAINT `chk_ad_target_one` CHECK (
  (`provinceCode` IS NOT NULL) + (`cityCode` IS NOT NULL) + (`schoolId` IS NOT NULL) = 1
);
ALTER TABLE `AdClick` ADD CONSTRAINT `chk_ad_click_billing` CHECK (
  `chargeAmount` >= 0
  AND ((`billing` = 'CHARGED') = (`billableDate` IS NOT NULL AND `chargeAmount` > 0))
);
ALTER TABLE `AdDailyStat` ADD CONSTRAINT `chk_ad_daily_stat` CHECK (
  `impressions` >= 0 AND `clicks` >= 0 AND `uniqueClicks` >= 0 AND `chargedClicks` >= 0 AND `spend` >= 0
);
ALTER TABLE `SponsorLedgerEntry` ADD CONSTRAINT `chk_ledger_amount` CHECK (
  `balanceAfter` >= 0
  AND ((`type` = 'TOPUP' AND `amount` > 0) OR (`type` = 'CLICK_CHARGE' AND `amount` < 0) OR (`type` = 'ADJUSTMENT' AND `amount` <> 0))
  AND ((`topUpRequestId` IS NOT NULL) = (`type` = 'TOPUP'))
  AND ((`adClickId` IS NOT NULL) = (`type` = 'CLICK_CHARGE'))
);
ALTER TABLE `TopUpRequest` ADD CONSTRAINT `chk_topup_amount` CHECK (`amount` > 0);

ALTER TABLE `PlatformSetting` ADD CONSTRAINT `chk_platform_setting` CHECK (
  `id` = 1 AND `defaultCpcAmount` BETWEEN 100 AND 100000 AND `minTopUpAmount` >= 10000
);

-- Baris tunggal pengaturan platform (nilai awal; dapat diubah super admin).
INSERT INTO `PlatformSetting` (`id`, `defaultCpcAmount`, `minTopUpAmount`, `deepLinkSchemes`, `createdAt`, `updatedAt`)
VALUES (1, 500, 100000, '["shopee","tokopedia","whatsapp"]', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `id` = `id`;
