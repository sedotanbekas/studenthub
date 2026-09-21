/**
 * Nama indeks unik dari error Prisma P2002 (murni). Adapter MariaDB menaruhnya di
 * `meta.driverAdapterError.cause.constraint.index`; engine lama memakai `meta.target`.
 * Mengembalikan null bila error bukan P2002, "" bila indeks tidak diketahui.
 */
type UniqueErrorShape = {
  code?: unknown;
  meta?: {
    target?: unknown;
    driverAdapterError?: { cause?: { constraint?: { index?: unknown; fields?: unknown } } };
  };
};

export function uniqueIndexOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const { code, meta } = error as UniqueErrorShape;
  if (code !== "P2002") return null;
  const index = meta?.driverAdapterError?.cause?.constraint?.index;
  if (typeof index === "string") return index;
  const target = meta?.target;
  if (typeof target === "string") return target;
  if (Array.isArray(target)) return target.join(",");
  return "";
}
