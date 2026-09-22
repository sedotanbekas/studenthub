import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  agentRules: false,
  // Modul native / berat dijalankan apa adanya di runtime Node, tidak di-bundle.
  serverExternalPackages: ["@node-rs/bcrypt", "sharp", "exceljs", "expo-server-sdk", "undici"],
};

export default nextConfig;
