import type { FileKind } from "@prisma/client";
import type { Principal } from "@/lib/auth/principal";

/**
 * Siapa boleh membaca berkas privat (murni). DENY → route menjawab 404 (id tak bisa dienumerasi),
 * GONE → 410 hanya untuk penonton yang sudah lolos ALLOW (status purge tidak bocor ke pihak lain).
 * Banner yang belum disetujui TIDAK terbuka untuk semua pengguna; salinan publiknya dilayani /media.
 */
export type FileAccess = "ALLOW" | "DENY" | "GONE";

export interface FileAccessView {
  readonly kind: FileKind;
  readonly schoolId: string | null;
  readonly sponsorId: string | null;
  readonly uploadedById: string;
  readonly deletedAt: Date | null;
}

export type FileViewer = Pick<Principal, "userId" | "role" | "schoolId" | "sponsorId">;

const SCHOOL_ADMIN_KINDS: ReadonlySet<FileKind> = new Set<FileKind>(["ATTENDANCE_SELFIE", "PAYMENT_PROOF", "LEAVE_ATTACHMENT"]);
const SPONSOR_KINDS: ReadonlySet<FileKind> = new Set<FileKind>(["AD_BANNER", "TOPUP_PROOF"]);

function isAllowed(viewer: FileViewer, file: FileAccessView): boolean {
  if (file.uploadedById === viewer.userId) return true;
  switch (viewer.role) {
    case "SUPER_ADMIN":
      return true;
    case "SCHOOL_ADMIN":
      return viewer.schoolId !== null && file.schoolId === viewer.schoolId && SCHOOL_ADMIN_KINDS.has(file.kind);
    case "SPONSOR":
      return viewer.sponsorId !== null && file.sponsorId === viewer.sponsorId && SPONSOR_KINDS.has(file.kind);
    default:
      return false;
  }
}

export function canReadFile(viewer: FileViewer, file: FileAccessView): FileAccess {
  if (!isAllowed(viewer, file)) return "DENY";
  return file.deletedAt === null ? "ALLOW" : "GONE";
}
