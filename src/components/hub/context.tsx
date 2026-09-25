"use client";
import { createContext, useContext } from "react";
import type { Identity } from "@/lib/frontend/types";
export interface HubContextValue { me: Identity; demo: boolean; schoolId: string; toast: (text: string) => void; reloadMe: () => Promise<void>; logout: () => Promise<void> }
export const HubContext = createContext<HubContextValue | null>(null);
export function useHub() { const value = useContext(HubContext); if (!value) throw new Error("Hub provider diperlukan."); return value; }
