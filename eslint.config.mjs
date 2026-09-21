import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Aturan klien: berkas kohesif (< 800 baris) dan fungsi kecil (< 50 baris).
      "max-lines": ["error", { max: 800, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["warn", { max: 50, skipBlankLines: true, skipComments: true }],
      "no-console": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.test.ts", "tests/**", "e2e/**", "scripts/**", "prisma/**"],
    rules: { "max-lines-per-function": "off" },
  },
  {
    files: ["src/lib/log.ts", "scripts/**"],
    rules: { "no-console": "off" },
  },
  globalIgnores([".next/**", "node_modules/**", "coverage/**", "playwright-report/**", "test-results/**", ".storage/**", "next-env.d.ts"]),
]);
