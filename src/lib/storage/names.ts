import type { FileKind } from "@prisma/client";
import { KIND_SEGMENT } from "./keys";

/** Nama berkas (murni): pembersihan nama asli dari klien dan nama unduhan yang dibuat server. */
const MAX_NAME_CODE_POINTS = 255;
// Karakter kontrol C0/C1 dan kontrol arah teks (bidi) yang bisa menyamarkan ekstensi (mis. U+202E).
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/g;

const EXT_BY_MIME: Readonly<Record<string, string>> = Object.freeze({
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/png": "png",
});

/** Basename saja (pemisah / dan \), tanpa karakter kontrol, maksimal 255 code point; kosong → null. */
export function sanitizeOriginalName(name: string | null | undefined): string | null {
  if (!name) return null;
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(UNSAFE_CHARS, "").trim();
  if (cleaned === "" || cleaned === "." || cleaned === "..") return null;
  return Array.from(cleaned).slice(0, MAX_NAME_CODE_POINTS).join("");
}

/** Nama unduhan `<kind-kebab>-<id>.<ext>`; id disaring ke karakter aman. */
export function downloadFilename(kind: FileKind, fileId: string, mimeType: string): string {
  const safeId = fileId.replace(/[^A-Za-z0-9_-]/g, "");
  return `${KIND_SEGMENT[kind]}-${safeId}.${EXT_BY_MIME[mimeType] ?? "bin"}`;
}
