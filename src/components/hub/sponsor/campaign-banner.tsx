"use client";
import { useState, type ChangeEvent } from "react";
import { api } from "@/lib/frontend/api";
import { IMAGE_ACCEPT, bannerFileProblem, bannerSizeProblem, campaignFailure } from "@/lib/frontend/campaign-rules";
import { useHub } from "../context";
import { Icon } from "../icon";
import { failureOf } from "./campaign-data";
import { FieldError } from "./campaign-fields";

/**
 * Pemilih banner: cek di klien (format, 5 MB, decode -> 2:1 ±2%, minimal 800×400) sebelum mengunggah ke
 * POST /sponsor/banners, pratinjau object URL seketika. Mode demo tidak mengunggah apa pun.
 */
export const BANNER_PLACEHOLDER = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 600"><rect width="1200" height="600" fill="#e2e8f0"/><rect x="24" y="24" width="1152" height="552" rx="28" fill="none" stroke="#94a3b8" stroke-width="6" stroke-dasharray="26 18"/><text x="600" y="318" font-family="Arial, sans-serif" font-size="54" font-weight="700" fill="#64748b" text-anchor="middle">Banner 1200 × 600</text></svg>')}`;
const DEMO_SAMPLE = "demo:ads/coding-cahaya.svg";
const UNREADABLE = "Gambar tidak dapat dibaca. Coba simpan ulang atau pilih berkas lain.";

async function imageSize(url: string): Promise<{ width: number; height: number }> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return { width: image.naturalWidth, height: image.naturalHeight };
}

interface BannerProps {
  readonly src: string;
  readonly hasBanner: boolean;
  readonly error?: string;
  readonly onError: (message: string | undefined) => void;
  /** fileId terpilih + object URL pratinjau (null untuk banner contoh demo). */
  readonly onPicked: (fileId: string, previewUrl: string | null) => void;
  readonly onLocalBanner: (fileId: string, url: string) => void;
  readonly onBusy: (busy: boolean) => void;
}

function useBannerUpload({ onError, onPicked, onLocalBanner, onBusy }: BannerProps) {
  const { demo } = useHub();
  const [status, setStatus] = useState<"idle" | "checking" | "uploading">("idle");
  const [note, setNote] = useState("");
  async function choose(file: File) {
    const problem = bannerFileProblem(file);
    if (problem) { onError(problem); return; }
    setStatus("checking"); setNote("");
    const url = URL.createObjectURL(file);
    const size = await imageSize(url).catch(() => null);
    const sizeProblem = size ? bannerSizeProblem(size.width, size.height) : UNREADABLE;
    if (sizeProblem || !size) { URL.revokeObjectURL(url); setStatus("idle"); onError(sizeProblem ?? UNREADABLE); return; }
    onError(undefined);
    if (demo) {
      const fileId = `demo-local:${Date.now()}`;
      onLocalBanner(fileId, url); onPicked(fileId, url); setStatus("idle");
      setNote("Mode demo: banner tidak diunggah, hanya dipratinjau di perangkat ini.");
      return;
    }
    setStatus("uploading"); onBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await api("/sponsor/banners", { method: "POST", body: form });
      onPicked((response.data as { fileId: string }).fileId, url);
      setNote(`Banner siap (${size.width}×${size.height} piksel). Disimpan sebagai 1200×600 dan tetap privat sampai kampanye disetujui.`);
    } catch (e) {
      URL.revokeObjectURL(url);
      onError(campaignFailure(failureOf(e)).message);
    } finally { setStatus("idle"); onBusy(false); }
  }
  const pickSample = () => { onError(undefined); onPicked(DEMO_SAMPLE, null); setNote("Mode demo: memakai banner contoh."); };
  return { demo, status, note, choose, pickSample };
}

export function BannerPicker(props: BannerProps) {
  const { src, hasBanner, error } = props;
  const { demo, status, note, choose, pickSample } = useBannerUpload(props);
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void choose(file);
  };
  const busy = status !== "idle";
  return <div className="banner-picker">
    <div className={`banner-frame${hasBanner ? " has-banner" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- pratinjau object URL / berkas privat; next/image tidak melayaninya */}
      <img src={src} alt={hasBanner ? "Pratinjau banner terpilih" : ""} draggable={false} />
      {busy && <span className="banner-busy" role="status"><span className="loader" aria-hidden="true" />{status === "uploading" ? "Mengunggah banner…" : "Memeriksa gambar…"}</span>}
    </div>
    <div className="banner-actions">
      <label className="button secondary small-button file-button">
        <input id="campaign-banner" type="file" accept={IMAGE_ACCEPT} disabled={busy} aria-invalid={Boolean(error)} aria-describedby={`campaign-banner-hint${error ? " campaign-banner-error" : ""}`} onChange={onFile} />
        <Icon name="upload" size={18} />{hasBanner ? "Ganti banner" : "Pilih banner"}
      </label>
      {demo && <button type="button" className="text-button" disabled={busy} onClick={pickSample}>Pakai banner contoh</button>}
    </div>
    <small className="field-hint" id="campaign-banner-hint">JPEG, PNG, atau WebP · rasio 2:1 (disarankan 1200×600) · maksimal 5 MB. Hindari teks kecil di tepi gambar.</small>
    {note && <p className="banner-note" role="status">{note}</p>}
    <FieldError id="campaign-banner" error={error} />
  </div>;
}
