import { z } from "zod";

/**
 * Paginasi mode halaman untuk tabel admin: `page` 1..10000, `limit` 1..100 (default 20).
 * Limit di atas maksimum DITOLAK 400 (bukan di-clamp) agar klien tahu batasnya.
 * Meta respons dibentuk dengan `pageMeta(total, page, limit)` dari `envelope.ts`.
 */
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;
export const MAX_PAGE = 10_000;

export const pageQuerySchema = z.object({
  page: z.coerce
    .number({ error: "page harus berupa angka." })
    .int("page harus bilangan bulat.")
    .min(1, "page minimal 1.")
    .max(MAX_PAGE, `page maksimal ${MAX_PAGE}.`)
    .default(1)
    .meta({ description: "Nomor halaman (mulai 1).", example: 1 }),
  limit: z.coerce
    .number({ error: "limit harus berupa angka." })
    .int("limit harus bilangan bulat.")
    .min(1, "limit minimal 1.")
    .max(MAX_PAGE_LIMIT, `limit maksimal ${MAX_PAGE_LIMIT}.`)
    .default(DEFAULT_PAGE_LIMIT)
    .meta({ description: `Jumlah baris per halaman (maks ${MAX_PAGE_LIMIT}).`, example: DEFAULT_PAGE_LIMIT }),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

export function toSkipTake(query: PageQuery): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.limit, take: query.limit };
}
