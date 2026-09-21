import "dotenv/config";
import { defineConfig } from "prisma/config";

// DATABASE_URL tidak wajib untuk `prisma generate` (mis. saat `pnpm install` di CI tanpa .env).
const databaseUrl = process.env.DATABASE_URL;
const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema",
  migrations: { path: "prisma/migrations" },
  ...(databaseUrl
    ? { datasource: { url: databaseUrl, ...(shadowDatabaseUrl ? { shadowDatabaseUrl } : {}) } }
    : {}),
});
