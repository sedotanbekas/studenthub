"use client";
import { createContext, useContext } from "react";
import type { LogoutReason } from "@/lib/frontend/identity-confirm-rules";
import type { Identity } from "@/lib/frontend/types";
import type { SchoolThemeColors } from "@/lib/schools/theme-rules";
export interface HubContextValue { me: Identity; demo: boolean; schoolId: string; toast: (text: string) => void; reloadMe: () => Promise<void>; logout: (reason?: LogoutReason) => Promise<void>; saveDemoTheme: (theme: SchoolThemeColors | null) => void }
export const HubContext = createContext<HubContextValue | null>(null);
export function useHub() { const value = useContext(HubContext); if (!value) throw new Error("Hub provider diperlukan."); return value; }
