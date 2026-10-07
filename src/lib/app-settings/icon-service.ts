import { notFound } from "@/lib/http/errors";
import { ICON_VARIANTS, type IconVariantName } from "./icon-rules";
import { renderIcon } from "./logo-image";
import { getBranding, readLogo } from "./service";

/**
 * Varian ikon dari logo unggahan (favicon, iOS, PWA, badge, splash), dibuat saat pertama diminta lalu disimpan di
 * memori proses per versi logo (paling banyak 7 berkas kecil). Logo diganti -> versi baru, cache lama dibuang.
 * Tanpa logo unggahan -> 404 LOGO_NOT_FOUND (klien memakai aset bawaan /brand, lihat iconUrlFor).
 */
export interface IconFile {
  readonly data: Buffer;
  readonly mimeType: string;
}

let cache: { version: number; files: Map<IconVariantName, IconFile> } | null = null;

export async function readIcon(name: IconVariantName): Promise<IconFile> {
  const { logoUpdatedAt } = await getBranding();
  if (!logoUpdatedAt) throw notFound("Logo aplikasi belum diunggah.", "LOGO_NOT_FOUND");
  const version = logoUpdatedAt.getTime();
  if (cache?.version !== version) cache = { version, files: new Map() };
  const hit = cache.files.get(name);
  if (hit) return hit;
  const variant = ICON_VARIANTS[name];
  const file = { data: await renderIcon((await readLogo()).data, variant), mimeType: variant.format === "webp" ? "image/webp" : "image/png" };
  cache.files.set(name, file);
  return file;
}
