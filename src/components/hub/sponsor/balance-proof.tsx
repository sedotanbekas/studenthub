"use client";
import type { ChangeEvent } from "react";
import { IMAGE_ACCEPT } from "@/lib/frontend/campaign-rules";
import { number } from "@/lib/frontend/format";
import { Icon } from "../icon";
import { FieldError } from "./campaign-fields";

/** Pilih foto bukti transfer + pratinjau. Validasi (HEIC, format, 8 MB) dilakukan pemanggil saat berkas dipilih. */
interface ProofProps {
  readonly file: File | null;
  readonly previewUrl: string | null;
  readonly error?: string;
  readonly onPick: (file: File) => void;
  readonly onClear: () => void;
}

const kb = (bytes: number) => `${number(Math.max(1, Math.round(bytes / 1024)))} KB`;

export function ProofField({ file, previewUrl, error, onPick, onClear }: ProofProps) {
  const id = "topup-file";
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (picked) onPick(picked);
  };
  const input = <input id={id} type="file" accept={IMAGE_ACCEPT} aria-invalid={Boolean(error)} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`} onChange={onChange} />;
  return <div className="field full-width">
    <span className="field-label">Foto bukti transfer</span>
    {file && previewUrl
      ? <div className="proof-chosen">
        {/* eslint-disable-next-line @next/next/no-img-element -- pratinjau object URL lokal; next/image tidak melayaninya */}
        <img src={previewUrl} alt="Pratinjau bukti transfer" />
        <span className="proof-name"><strong>{file.name}</strong><small>{kb(file.size)}</small></span>
        <label className="button secondary small-button file-button">{input}Ganti</label>
        <button type="button" className="icon-button" aria-label="Hapus foto bukti" onClick={onClear}><Icon name="close" size={18} /></button>
      </div>
      : <label className="file-picker proof-drop"><Icon name="camera" size={24} /><span>Pilih foto atau tangkapan layar bukti<small>Pastikan nominal, tanggal, dan rekening tujuan terbaca.</small></span>{input}</label>}
    <small className="field-hint" id={`${id}-hint`}>JPEG, PNG, atau WebP · maksimal 8 MB. Foto HEIC dari iPhone belum didukung.</small>
    <FieldError id={id} error={error} />
  </div>;
}
