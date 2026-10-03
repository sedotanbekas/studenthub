import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  agentRules: false,
  // Modul native / berat dijalankan apa adanya di runtime Node, tidak di-bundle.
  serverExternalPackages: ["@node-rs/bcrypt", "sharp", "exceljs", "expo-server-sdk", "undici", "web-push"],
  // Service worker Web Push (N3): selalu versi terbaru, hanya skrip dari origin sendiri.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
