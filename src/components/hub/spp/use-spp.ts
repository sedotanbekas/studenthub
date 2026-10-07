"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/frontend/api";
import { demoMonths, demoSppAnalytics } from "@/lib/frontend/demo-spp";
import { sppQuery, type SppAnalytics, type SppFilter } from "@/lib/frontend/spp-analytics-rules";
import { useHub } from "../context";

/** Data Analitik SPP untuk filter aktif. Data lama dipertahankan selama memuat ulang (grafik tidak berkedip). */
export function useSppAnalytics(filter: SppFilter, version: number) {
  const { demo } = useHub();
  const path = sppQuery(filter);
  const [state, setState] = useState<{ data: SppAnalytics | null; error: string; loading: boolean }>({ data: null, error: "", loading: false });
  useEffect(() => {
    if (!path) return;
    let active = true;
    const load = demo ? Promise.resolve(demoSppAnalytics(filter, demoMonths(new Date(), filter.months))) : api(path).then(r => r.data as SppAnalytics);
    Promise.resolve().then(() => { if (active) setState(s => ({ ...s, loading: true, error: "" })); });
    load.then(data => { if (active) setState({ data, error: "", loading: false }); })
      .catch(e => { if (active) setState(s => ({ ...s, error: e instanceof Error ? e.message : "Analitik belum dapat dimuat.", loading: false })); });
    return () => { active = false; };
  }, [path, demo, version, filter]);
  return { ...state, incomplete: path === null };
}

export interface Choice { readonly value: string; readonly label: string }

const DEMO_CHOICES: Readonly<Record<string, Choice[]>> = {
  provinces: [{ value: "32", label: "Jawa Barat" }, { value: "31", label: "DKI Jakarta" }],
  cities: [{ value: "32.73", label: "Kota Bandung" }, { value: "32.76", label: "Kota Depok" }],
  schools: [{ value: "demo-school-1", label: "SMP Negeri 1 Harapan Jaya (Demo)" }],
};

/** Pilihan untuk select (provinsi, kota, sekolah); path null = tidak dimuat. */
export function useChoices(kind: "provinces" | "cities" | "schools", path: string | null): Choice[] {
  const { demo } = useHub();
  const [choices, setChoices] = useState<{ path: string | null; items: Choice[] }>({ path: null, items: [] });
  useEffect(() => {
    if (!path || demo) return;
    let active = true;
    api(path).then(r => {
      const rows = (r.data ?? []) as { code?: string; id?: string; name: string }[];
      if (active) setChoices({ path, items: rows.map(row => ({ value: String(row.code ?? row.id), label: row.name })) });
    }).catch(() => { if (active) setChoices({ path, items: [] }); });
    return () => { active = false; };
  }, [path, demo]);
  if (demo) return path ? DEMO_CHOICES[kind] ?? [] : [];
  return choices.path === path ? choices.items : [];
}
