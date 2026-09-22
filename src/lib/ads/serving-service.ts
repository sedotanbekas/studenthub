import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { publicUrlFor } from "@/lib/storage/keys";
import { studentSelf } from "@/lib/tenant/scope";
import { matchesTarget, type SchoolLocation } from "./ad-rules";
import { MAX_SERVE_CANDIDATES, SERVE_REFRESH_HINT_SECONDS } from "./constants";
import { rotationSeed, selectAdsForSlider } from "./rotation";
import { signAdToken } from "./token";

/**
 * Slider iklan siswa. Kandidat: APPROVED, dalam jadwal (startAt <= now < endAt), sponsor APPROVED, salinan
 * banner publik ada, saldo sponsor >= CPC iklan, target cocok dengan sekolah siswa (semua / provinsi / kab-kota /
 * sekolah). Rotasi deterministik per jam WIB, maks 5 & maks 2 per sponsor. Tiap iklan membawa token event
 * bertanda tangan (6 jam, terikat siswa). Sekolah nonaktif -> daftar kosong.
 */
export interface ServedAd {
  readonly token: string;
  readonly adId: string;
  readonly title: string;
  readonly imageUrl: string;
  readonly targetUrl: string;
  readonly linkType: "EXTERNAL_URL" | "DEEP_LINK";
  readonly sponsorName: string;
}

export interface ServedAds {
  readonly ads: ServedAd[];
  readonly refreshAfterSeconds: number;
}

function loadCandidates(school: SchoolLocation, now: Date) {
  return prisma.ad.findMany({
    where: {
      status: "APPROVED",
      startAt: { lte: now },
      endAt: { gt: now },
      publicImageKey: { not: null },
      sponsor: { status: "APPROVED" },
      OR: [
        { targetScope: "ALL" },
        { targetScope: "PROVINCE", targets: { some: { provinceCode: school.provinceCode } } },
        { targetScope: "CITY", targets: { some: { cityCode: school.cityCode } } },
        { targetScope: "SCHOOL", targets: { some: { schoolId: school.id } } },
      ],
    },
    orderBy: { id: "asc" },
    take: MAX_SERVE_CANDIDATES,
    select: {
      id: true, sponsorId: true, title: true, targetUrl: true, linkType: true, cpcAmount: true, publicImageKey: true, targetScope: true,
      targets: { select: { provinceCode: true, cityCode: true, schoolId: true } },
      sponsor: { select: { companyName: true, balance: true } },
    },
  });
}

/** GET /student/ads. */
export async function serveAds(ctx: ActionContext): Promise<ServedAds> {
  const self = studentSelf(requirePrincipal(ctx));
  const school = await prisma.school.findFirst({ where: { id: self.schoolId, isActive: true }, select: { id: true, provinceCode: true, cityCode: true } });
  if (!school) return { ads: [], refreshAfterSeconds: SERVE_REFRESH_HINT_SECONDS };
  const candidates = (await loadCandidates(school, ctx.now)).filter(
    (ad) => ad.sponsor.balance >= ad.cpcAmount && matchesTarget(ad.targetScope, ad.targets, school),
  );
  const picked = selectAdsForSlider(candidates, rotationSeed(self.userId, ctx.now));
  const env = getEnv();
  const ads = await Promise.all(
    picked.map(async (ad) => ({
      token: await signAdToken({ adId: ad.id, sponsorId: ad.sponsorId, userId: self.userId, schoolId: school.id }, env.AD_EVENT_SECRET, ctx.now),
      adId: ad.id,
      title: ad.title,
      imageUrl: publicUrlFor(ad.publicImageKey ?? "", env.PUBLIC_MEDIA_BASE_URL),
      targetUrl: ad.targetUrl,
      linkType: ad.linkType,
      sponsorName: ad.sponsor.companyName,
    })),
  );
  return { ads, refreshAfterSeconds: SERVE_REFRESH_HINT_SECONDS };
}
