import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Modul native / berat dijalankan apa adanya di runtime Node, tidak di-bundle.
  serverExternalPackages: ["@node-rs/bcrypt", "sharp", "exceljs", "expo-server-sdk"],
};

export default nextConfig;
