"use client";
import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import {
  displayNumeric,
  inputModeFor,
  numericDraft,
  parseNumeric,
  rangeProblem,
  sanitizeNumeric,
  type NumericSpec,
  type NumericValue,
} from "@/lib/frontend/numeric-input-rules";

type NativeProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min" | "max" | "inputMode">;
interface NumericInputProps extends NativeProps {
  spec: NumericSpec;
  value: unknown;
  minimum?: number;
  maximum?: number;
  onValue: (value: NumericValue) => void;
}

const same = (a: unknown, b: unknown): boolean => (a ?? undefined) === (b ?? undefined);

/**
 * Isian angka tanpa karakter bebas: huruf/simbol dibuang saat diketik atau ditempel (bukan type="number",
 * yang tetap menerima "e", "+", "." dan melaporkan "" saat isian tidak sah). Batas nilai lewat setCustomValidity
 * sehingga balon validasi bawaan browser tetap muncul saat kirim.
 */
export function NumericInput({ spec, value, minimum, maximum, onValue, ...rest }: NumericInputProps) {
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(() => numericDraft(value, spec));
  // Draf dipertahankan selama mewakili nilai saat ini ("-6." saat mengetik); nilai dari luar (nilai awal, reset) menang.
  const shown = same(parseNumeric(draft, spec), value === "" ? undefined : value) ? draft : numericDraft(value, spec);
  const problem = rangeProblem(parseNumeric(shown, spec), spec, { minimum, maximum });
  useEffect(() => { input.current?.setCustomValidity(problem); }, [problem]);
  return <input ref={input} {...rest} type="text" inputMode={inputModeFor(spec)} autoComplete={spec.kind === "phone" ? "tel" : "off"}
    value={displayNumeric(shown, spec)} aria-invalid={problem ? true : undefined} title={problem || undefined}
    onChange={e => { const next = sanitizeNumeric(e.target.value, spec); setDraft(next); onValue(parseNumeric(next, spec)); }} />;
}

interface NumericFieldProps {
  caption: ReactNode;
  spec: NumericSpec;
  value: unknown;
  required?: boolean;
  nullable?: boolean;
  minimum?: number;
  maximum?: number;
  placeholder?: string;
  hint?: string;
  onChange: (value: unknown) => void;
}

/** Field formulir umum untuk isian angka; nominal diberi awalan "Rp" dan pemisah ribuan. */
export function NumericField({ caption, spec, value, required, nullable, minimum, maximum, placeholder, hint, onChange }: NumericFieldProps) {
  const input = <NumericInput spec={spec} value={value} required={required} minimum={minimum} maximum={maximum}
    placeholder={spec.kind === "money" ? "0" : placeholder} onValue={next => onChange(next === undefined ? (nullable ? null : undefined) : next)} />;
  return <label className="field">{caption}
    {spec.kind === "money" ? <span className="money-input compact"><span aria-hidden="true">Rp</span>{input}</span> : input}
    {hint && <small className="field-hint">{hint}</small>}</label>;
}
