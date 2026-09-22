import type { AnyContract } from "@/lib/http/contract";
import { sponsorPlatformContracts } from "./contracts-platform";
import { sponsorSelfContracts } from "./contracts-self";

/** Kontrak route domain sponsors: super admin (/platform/sponsors*, /platform/topups*, /platform/settings/ads) + sponsor (/sponsor/*). */
export const sponsorsContracts: readonly AnyContract[] = [...sponsorPlatformContracts, ...sponsorSelfContracts];
