import { AppError } from "./errors";

type PrismaLike = { code?: unknown; meta?: { target?: unknown; constraint?: unknown; driverAdapterError?: unknown } };

/** Kode error MariaDB untuk pelanggaran CHECK constraint. */
const MARIADB_CHECK_VIOLATION = 4025;

/**
 * Menerjemahkan error Prisma/MariaDB yang dikenal. Mengembalikan null bila tidak dikenal
 * (pemanggil memperlakukannya sebagai 500). Pesan asli TIDAK pernah diteruskan ke klien.
 */
export function mapPrismaError(error: unknown): AppError | null {
  if (typeof error !== "object" || error === null) return null;
  const { code, meta } = error as PrismaLike;
  switch (code) {
    case "P2002":
      return new AppError(409, "DUPLICATE", "Data yang sama sudah ada.", { fields: meta?.target ?? null });
    case "P2025":
      return new AppError(404, "NOT_FOUND", "Data tidak ditemukan.");
    case "P2034":
      return new AppError(409, "CONFLICT_RETRY", "Terjadi bentrokan data bersamaan. Silakan ulangi.");
    case "P2003":
      return new AppError(409, "STATE_CONFLICT", "Data masih dirujuk atau rujukan tidak valid.");
    default:
      return null;
  }
}

/** true bila error berasal dari pelanggaran CHECK constraint (bug: validasi aplikasi terlewat). */
export function isCheckViolation(error: unknown): boolean {
  const text = JSON.stringify((error as PrismaLike | null)?.meta ?? {});
  return text.includes(String(MARIADB_CHECK_VIOLATION)) || /CONSTRAINT `?chk_/i.test(text);
}
