import { z } from "zod";

/** Pesan validasi zod berbahasa Indonesia untuk seluruh aplikasi. */
let configured = false;
export function configureZod(): void {
  if (configured) return;
  z.config(z.locales.id());
  configured = true;
}
configureZod();
