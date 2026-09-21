import { randomBytes } from "node:crypto";
import path from "node:path";
import type { FileKind } from "@prisma/client";
import { badRequest, type AppError } from "@/lib/http/errors";

/**
 * Kunci penyimpanan dibuat HANYA oleh server: `<bucket>/<kind-kebab>/<yyyy>/<mm>/<rand22>.<ext>`.
 * Pengguna tidak pernah mengendalikan path. Setiap kunci divalidasi regex ketat sebelum menyentuh disk.
 */
export type StorageBucket = "public" | "private";
export type StorageExt = "jpg" | "webp";

export interface ParsedStorageKey {
  readonly bucket: StorageBucket;
  readonly kind: FileKind;
  readonly year: number;
  readonly month: number;
  readonly id: string;
  readonly ext: StorageExt;
}

export const KIND_SEGMENT: Readonly<Record<FileKind, string>> = Object.freeze({
  AD_BANNER: "ad-banner",
  ATTENDANCE_SELFIE: "attendance-selfie",
  PAYMENT_PROOF: "payment-proof",
  TOPUP_PROOF: "topup-proof",
  LEAVE_ATTACHMENT: "leave-attachment",
});

const SEGMENT_KIND: ReadonlyMap<string, FileKind> = new Map(
  (Object.entries(KIND_SEGMENT) as [FileKind, string][]).map(([kind, seg]) => [seg, kind]),
);

/** Hanya banner iklan yang boleh berada di bucket publik (salinan setelah iklan disetujui). */
const PUBLIC_KINDS: ReadonlySet<FileKind> = new Set<FileKind>(["AD_BANNER"]);

const KEY_RE =
  /^(?<bucket>public|private)\/(?<segment>attendance-selfie|ad-banner|payment-proof|topup-proof|leave-attachment)\/(?<year>\d{4})\/(?<month>0[1-9]|1[0-2])\/(?<id>[A-Za-z0-9_-]{22})\.(?<ext>jpg|webp)$/;

interface KeyGroups {
  readonly bucket: StorageBucket;
  readonly segment: string;
  readonly year: string;
  readonly month: string;
  readonly id: string;
  readonly ext: StorageExt;
}

const RANDOM_BYTES = 16;

function invalidKey(): AppError {
  return badRequest("INVALID_STORAGE_KEY", "Kunci penyimpanan tidak valid.");
}

export type RandomSource = (size: number) => Uint8Array;

export function buildStorageKey(
  kind: FileKind,
  ext: StorageExt,
  now: Date,
  bucket: StorageBucket,
  rand: RandomSource = randomBytes,
): string {
  if (bucket === "public" && !PUBLIC_KINDS.has(kind)) {
    throw new Error(`Jenis berkas ${kind} tidak boleh disimpan di bucket publik`);
  }
  const yyyy = String(now.getUTCFullYear()).padStart(4, "0");
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const id = Buffer.from(rand(RANDOM_BYTES)).toString("base64url");
  const key = `${bucket}/${KIND_SEGMENT[kind]}/${yyyy}/${mm}/${id}.${ext}`;
  parseStorageKey(key);
  return key;
}

export function parseStorageKey(key: string): ParsedStorageKey {
  const groups = KEY_RE.exec(key)?.groups as KeyGroups | undefined;
  if (!groups) throw invalidKey();
  const { bucket, segment, year, month, id, ext } = groups;
  const kind = SEGMENT_KIND.get(segment);
  if (!kind) throw invalidKey();
  if (bucket === "public" && !PUBLIC_KINDS.has(kind)) throw invalidKey();
  return { bucket, kind, year: Number(year), month: Number(month), id, ext };
}

/**
 * Path absolut kunci di dalam `root`. Kunci divalidasi regex (menolak `..`, path absolut, backslash,
 * NUL), lalu hasil resolve diperiksa ulang harus tetap di bawah root (pertahanan berlapis).
 * `pathApi` hanya untuk test lintas platform (path.posix / path.win32).
 */
export function resolveInsideRoot(root: string, key: string, pathApi: path.PlatformPath = path): string {
  parseStorageKey(key);
  const base = pathApi.resolve(root);
  const full = pathApi.resolve(base, ...key.split("/"));
  const prefix = base.endsWith(pathApi.sep) ? base : base + pathApi.sep;
  if (!full.startsWith(prefix) || full.length <= prefix.length) throw invalidKey();
  return full;
}

/** Kunci salinan publik untuk banner privat: `private/ad-banner/...` → `public/ad-banner/...`. */
export function publicKeyFor(privateKey: string): string {
  const parsed = parseStorageKey(privateKey);
  if (parsed.bucket !== "private" || !PUBLIC_KINDS.has(parsed.kind)) throw invalidKey();
  return `public/${privateKey.slice("private/".length)}`;
}

/** URL publik (nginx `/media/`) untuk kunci di bucket publik. */
export function publicUrlFor(key: string, baseUrl: string): string {
  const parsed = parseStorageKey(key);
  if (parsed.bucket !== "public") throw invalidKey();
  return `${baseUrl.replace(/\/+$/, "")}/${key.slice("public/".length)}`;
}
