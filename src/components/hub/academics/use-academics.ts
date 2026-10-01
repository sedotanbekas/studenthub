"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, ApiError, scoped } from "@/lib/frontend/api";
import type { AcademicSnapshot, ClassView, SubjectView, YearView } from "@/lib/frontend/academics-rules";
import type { EducationLevel } from "@/lib/schools/education-level";
import { localParts, type LocalDate, type SchoolTz } from "@/lib/time/zone";
import { useHub } from "../context";
import { demoAcademics } from "./academics-demo";

/** Fakta sekolah yang dibutuhkan halaman Akademik (dari GET /school/profile). */
export interface SchoolFacts {
  readonly educationLevel: EducationLevel | null;
  readonly timezone: SchoolTz;
  readonly checkInCloseMinute: number;
  /** Tanggal lokal sekolah menurut server. */
  readonly today: LocalDate;
}

export interface AcademicsData {
  readonly school: SchoolFacts;
  readonly years: readonly YearView[];
  readonly classes: readonly ClassView[];
  readonly subjects: readonly SubjectView[];
}

type Method = "POST" | "PATCH" | "PUT" | "DELETE";

export interface AcademicsContextValue {
  readonly data: AcademicsData;
  readonly canManage: boolean;
  readonly isSuperAdmin: boolean;
  readonly reload: () => Promise<void>;
  readonly mutate: (path: string, method: Method, body?: unknown) => Promise<unknown>;
  readonly get: <T>(path: string) => Promise<T>;
  readonly toast: (text: string) => void;
}

interface ProfileDto {
  readonly educationLevel: EducationLevel | null;
  readonly timezone: SchoolTz;
  readonly checkInCloseMinute: number;
  readonly setupChecklist: { readonly today: LocalDate };
}

const DEMO_BLOCKED = "Mode demo hanya untuk melihat-lihat. Masuk dengan akun sekolah untuk menyimpan perubahan.";

async function loadAll(get: <T>(path: string) => Promise<T>): Promise<AcademicsData> {
  const [profile, years, subjects] = await Promise.all([get<ProfileDto>("/school/profile"), get<YearView[]>("/school/academic-years"), get<SubjectView[]>("/school/subjects")]);
  const perYear = await Promise.all(years.map((year) => get<ClassView[]>(`/school/classes?academicYearId=${encodeURIComponent(year.id)}`)));
  const school = { educationLevel: profile.educationLevel, timezone: profile.timezone, checkInCloseMinute: profile.checkInCloseMinute, today: profile.setupChecklist.today };
  return { school, years, classes: perYear.flat(), subjects };
}

export interface AcademicsState {
  readonly data: AcademicsData | null;
  readonly error: string;
  readonly loading: boolean;
  readonly value: AcademicsContextValue | null;
  readonly retry: () => void;
}

/** Muat seluruh data akademik sekolah (ringan: puluhan baris) dan sediakan mutasi + muat ulang. */
export function useAcademicsState(enabled: boolean): AcademicsState {
  const { me, demo, schoolId, toast } = useHub();
  const [data, setData] = useState<AcademicsData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const get = useCallback(async <T,>(path: string): Promise<T> => (await api(scoped(path, schoolId))).data as T, [schoolId]);
  const [version, setVersion] = useState(0);
  const fetchData = useCallback((): Promise<AcademicsData> => (demo ? Promise.resolve(demoAcademics(localParts(new Date(), "WIB").ymd)) : loadAll(get)), [demo, get]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetchData()
      .then((next) => { if (active) { setData(next); setError(""); setLoading(false); } })
      .catch((e: unknown) => { if (active) { setError(e instanceof Error ? e.message : "Data akademik belum berhasil dimuat."); setLoading(false); } });
    return () => { active = false; };
  }, [enabled, fetchData, version]);
  const retry = useCallback(() => { setLoading(true); setError(""); setVersion((v) => v + 1); }, []);
  /** Dipanggil sesudah simpan: data terbaru langsung dipakai (galat diteruskan ke formulir). */
  const reload = useCallback(async () => { setData(await fetchData()); }, [fetchData]);
  const mutate = useCallback(async (path: string, method: Method, body?: unknown) => {
    if (demo) throw new ApiError(DEMO_BLOCKED, "DEMO");
    return (await api(scoped(path, schoolId), { method, body: body === undefined ? undefined : JSON.stringify(body) })).data;
  }, [demo, schoolId]);
  const canManage = demo || me.permissions.includes("academics.manage");
  const value = data ? { data, canManage, isSuperAdmin: me.user.role === "SUPER_ADMIN", reload, mutate, get, toast } : null;
  return { data, error, loading, value, retry };
}

export const AcademicsContext = createContext<AcademicsContextValue | null>(null);

export function useAcademics(): AcademicsContextValue {
  const value = useContext(AcademicsContext);
  if (!value) throw new Error("AcademicsContext diperlukan.");
  return value;
}

/** Status kirim formulir: busy + pesan galat server (sudah Bahasa Indonesia). */
export function useSaving(): { busy: boolean; error: string; setError: (text: string) => void; run: (fn: () => Promise<void>) => Promise<void> } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Perubahan belum tersimpan. Coba lagi."); } finally { setBusy(false); }
  }, []);
  return { busy, error, setError, run };
}

export const snapshotOf = (data: AcademicsData): AcademicSnapshot => ({ educationLevel: data.school.educationLevel, today: data.school.today, years: data.years, classes: data.classes, subjects: data.subjects });
