import { appEnvOfHost } from "@/lib/frontend/app-env";

/**
 * Server ini PRODUKSI? Dikenali dari APP_ORIGIN (domain produksi di src/lib/frontend/app-env.ts), tanpa variabel
 * env tambahan. Tanpa APP_ORIGIN / tidak sah (unit test, lokal) = bukan produksi.
 */
export function isProductionServer(origin: string | undefined = process.env.APP_ORIGIN): boolean {
  if (!origin) return false;
  try {
    return appEnvOfHost(new URL(origin).host) === "production";
  } catch {
    return false;
  }
}
