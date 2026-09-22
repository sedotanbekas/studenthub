import type { AnyContract } from "@/lib/http/contract";
import { adsAnalyticsContracts } from "./contracts-analytics";
import { adsPlatformContracts } from "./contracts-platform";
import { adsSponsorContracts } from "./contracts-sponsor";
import { adsStudentContracts } from "./contracts-student";

/** Kontrak route domain ads: sponsor (/sponsor/ads*, banner, analitik), super admin (/platform/ads*), siswa (/student/ads*). */
export const adsContracts: readonly AnyContract[] = [...adsSponsorContracts, ...adsAnalyticsContracts, ...adsPlatformContracts, ...adsStudentContracts];
