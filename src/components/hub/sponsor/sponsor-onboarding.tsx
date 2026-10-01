"use client";
import { checklistComplete, sponsorOnboardingSteps, type SponsorFacts } from "@/lib/frontend/onboarding-rules";
import { ChecklistCard } from "../checklist-card";

/**
 * Beranda sponsor baru: persetujuan akun -> isi saldo -> kampanye pertama -> tayang. Memakai data yang sudah dimuat
 * Beranda (profil, saldo, iklan); hilang sendiri setelah kampanye pertama tayang.
 */
interface Props {
  readonly profile: { readonly status: SponsorFacts["status"]; readonly statusReason: string | null } | null | undefined;
  readonly balance: { readonly balance: number; readonly pendingTopUps: number } | null | undefined;
  readonly ads: readonly { readonly displayStatus: string }[] | null | undefined;
}

export function SponsorOnboarding({ profile, balance, ads }: Props) {
  if (!profile || !balance || !ads) return null;
  const steps = sponsorOnboardingSteps({
    status: profile.status, statusReason: profile.statusReason, balance: balance.balance, pendingTopUps: balance.pendingTopUps,
    adsCount: ads.length, liveCount: ads.filter((ad) => ad.displayStatus === "LIVE").length,
  });
  if (checklistComplete(steps)) return null;
  return <ChecklistCard eyebrow="Mulai beriklan" title="Langkah sampai kampanye tayang" intro="Ikuti urutannya; setiap langkah menjelaskan kenapa perlu dan membuka halamannya langsung." steps={steps} />;
}
