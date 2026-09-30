"use client";
import { useState, type InputHTMLAttributes } from "react";
import { Icon } from "./icon";

/** Isian kata sandi + tombol mata (tampilkan/sembunyikan) — dipakai SEMUA kolom kata sandi. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  return <span className="password-input"><input {...props} type={visible ? "text" : "password"} /><button type="button" aria-label={visible ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"} aria-pressed={visible} onClick={() => setVisible(v => !v)}><Icon name={visible ? "eye-off" : "eye"} size={20} /></button></span>;
}
