"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/frontend/api";
import { DEMO_PERSONAS, demoPersona } from "@/lib/frontend/demo-personas";
import { demoHintCookie, initialSessionView, type SessionHint } from "@/lib/frontend/session-hint";
import { readDemoTheme, writeDemoTheme } from "@/lib/frontend/theme";
import type { SchoolThemeColors } from "@/lib/schools/theme-rules";
import type { Identity } from "@/lib/frontend/types";
import { loadSections } from "./sections";
import { forgetResume, playLogoutSplash } from "./splash";

/**
 * Sesi web: akun sungguhan (cookie HttpOnly lewat /api/web) atau persona demo (sessionStorage).
 * Setiap pergantian identitas (masuk, keluar, masuk demo, ganti persona) mereset state; HubShell lalu
 * mengalihkan ke beranda bila halaman saat itu bukan milik peran baru (URL peran lain tidak terbawa).
 */
const DEMO_FLAG = "studenthub_demo";
const DEMO_ROLE = "studenthub_demo_role";
const SCHOOL_KEY = "studenthub_school";

function demoIdentity(key: string): Identity {
  const identity = demoPersona(key).identity;
  const theme = readDemoTheme(sessionStorage);
  // Bentuk sama seperti school.theme dari GET /auth/me.
  return identity.school && theme ? { ...identity, school: { ...identity.school, theme: { ...theme, preset: null, isCustom: true, updatedAt: null } } } : identity;
}

/** Kunci persona demo tersimpan; bendera demo tanpa persona valid dianggap rusak dan dibersihkan. */
function restoredDemoKey(): string | null {
  if (sessionStorage.getItem(DEMO_FLAG) !== "true") return null;
  const key = sessionStorage.getItem(DEMO_ROLE);
  if (key && DEMO_PERSONAS.some(p => p.key === key)) return key;
  clearDemoStorage();
  return null;
}

function clearDemoStorage() {
  for (const key of [DEMO_FLAG, DEMO_ROLE, SCHOOL_KEY]) sessionStorage.removeItem(key);
  writeDemoTheme(sessionStorage, null);
  writeDemoHint(false);
}

/** Penanda demo untuk render server /hub (src/lib/frontend/session-hint.ts). */
function writeDemoHint(on: boolean) {
  document.cookie = demoHintCookie(on, location.protocol === "https:");
}

/** Sesi akun dari sebelum penanda sesi ada: GET /session selalu 200, jadi pengunjung baru tanpa galat konsol. */
async function legacySession(): Promise<Identity | null> {
  const response = await fetch("/api/web/session", { cache: "no-store" });
  const body = await response.json() as { data?: { active?: boolean } };
  return body.data?.active ? (await api("/auth/me")).data as Identity : null;
}

/** Hapus cookie sesi server tanpa memicu event "sesi berakhir" (proxy selalu menghapus cookie). */
function endServerSession(): Promise<void> {
  return fetch("/api/web/auth/logout", { method: "POST", cache: "no-store" }).then(() => undefined, () => undefined);
}

export interface HubSession {
  readonly me: Identity | null;
  readonly ready: boolean;
  readonly demo: boolean;
  readonly schoolId: string;
  readonly notice: string;
  setNotice: (text: string) => void;
  setSchoolId: (id: string) => void;
  /** `covered`: identitas baru dipasang setelah tirai splash login menutup layar. */
  login: (covered?: Promise<void>) => Promise<void>;
  logout: () => Promise<void>;
  reloadMe: () => Promise<void>;
  startDemo: (key: string, covered?: Promise<void>) => void;
  switchPersona: (key: string) => void;
  saveDemoTheme: (theme: SchoolThemeColors | null) => void;
}

/**
 * State sesi + pemulihan saat halaman dimuat: persona demo tersimpan, cookie akun via /auth/me (ada
 * penanda sesi), atau — tanpa penanda — halaman masuk yang sudah dirender server tetap tampil sambil
 * memeriksa sesi lama lewat GET /session (tanpa 401/400 di konsol).
 */
function useSessionState(hint: SessionHint) {
  const [me, setMe] = useState<Identity | null>(null);
  const [ready, setReady] = useState(() => initialSessionView(hint) === "login");
  const [demo, setDemo] = useState(false);
  const [schoolId, setSchoolIdState] = useState("");
  const [notice, setNotice] = useState("");
  const account = hint.account;
  useEffect(() => {
    let active = true;
    const key = restoredDemoKey();
    if (key) {
      void loadSections(); writeDemoHint(true);
      Promise.resolve().then(() => { if (active) { setDemo(true); setMe(demoIdentity(key)); setReady(true); } });
    } else if (account) {
      void loadSections();
      api("/auth/me").then(r => { if (active) setMe(r.data as Identity); }).catch(() => {}).finally(() => { if (active) setReady(true); });
    } else {
      Promise.resolve().then(() => { if (active) setReady(true); });
      legacySession().then(identity => { if (active && identity) setMe(identity); }).catch(() => {});
    }
    Promise.resolve().then(() => { if (active) setSchoolIdState(sessionStorage.getItem(SCHOOL_KEY) ?? ""); });
    return () => { active = false; };
  }, [account]);
  useEffect(() => {
    const expired = () => { setMe(null); setNotice("Sesi berakhir. Silakan masuk kembali."); };
    window.addEventListener("studenthub:expired", expired);
    return () => window.removeEventListener("studenthub:expired", expired);
  }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 4500); return () => clearTimeout(timer); }, [notice]);
  return { me, setMe, ready, setReady, demo, setDemo, schoolId, setSchoolIdState, notice, setNotice };
}

export function useHubSession(hint: SessionHint): HubSession {
  const router = useRouter();
  const { me, setMe, ready, setReady, demo, setDemo, schoolId, setSchoolIdState, notice, setNotice } = useSessionState(hint);

  const reloadMe = useCallback(async () => { const result = await api("/auth/me"); setMe(result.data as Identity); setReady(true); }, [setMe, setReady]);

  const login = useCallback(async (covered: Promise<void> = Promise.resolve()) => {
    void loadSections(); // diunduh bersamaan dengan /auth/me & tirai splash
    clearDemoStorage();
    const identity = (await api("/auth/me")).data as Identity;
    await covered;
    setDemo(false); setSchoolIdState(""); setMe(identity); setReady(true);
  }, [setDemo, setMe, setReady, setSchoolIdState]);

  const startDemo = useCallback((key: string, covered: Promise<void> = Promise.resolve()) => {
    void loadSections();
    void endServerSession(); // pastikan tidak ada sesi akun sungguhan yang tersisa di balik mode demo
    sessionStorage.setItem(DEMO_FLAG, "true"); sessionStorage.setItem(DEMO_ROLE, key); writeDemoHint(true);
    void covered.then(() => { setDemo(true); setSchoolIdState(""); setMe(demoIdentity(key)); });
  }, [setDemo, setMe, setSchoolIdState]);

  const switchPersona = useCallback((key: string) => {
    sessionStorage.setItem(DEMO_ROLE, key);
    setMe(demoIdentity(key));
  }, [setMe]);

  const logout = useCallback(async () => {
    // Keluar berlaku SEKETIKA (penyimpanan demo & halaman terakhir dihapus, sesi dicabut) walau halaman
    // dimuat ulang di tengah animasi; hanya pergantian tampilan yang menunggu layar tertutup logo, lalu
    // tirai menyusut ke tombol Masuk (animasi keluar = masuk dibalik, splash.ts).
    const covered = playLogoutSplash();
    clearDemoStorage();
    forgetResume(); // keluar = sesi kerja selesai: halaman terakhir tidak dilanjutkan
    if (!demo) await api("/auth/logout", { method: "POST" }).catch(() => endServerSession());
    await covered;
    setDemo(false); setSchoolIdState(""); setMe(null);
    router.replace("/hub", { scroll: false }); // posisi gulir diatur scroll-memory.ts
  }, [demo, router, setDemo, setMe, setSchoolIdState]);

  const setSchoolId = useCallback((id: string) => { setSchoolIdState(id); sessionStorage.setItem(SCHOOL_KEY, id); }, [setSchoolIdState]);

  const saveDemoTheme = useCallback((theme: SchoolThemeColors | null) => {
    writeDemoTheme(sessionStorage, theme);
    const key = sessionStorage.getItem(DEMO_ROLE);
    if (key) setMe(demoIdentity(key));
  }, [setMe]);

  return { me, ready, demo, schoolId, notice, setNotice, setSchoolId, login, logout, reloadMe, startDemo, switchPersona, saveDemoTheme };
}
