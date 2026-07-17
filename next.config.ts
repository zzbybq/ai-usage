import type { NextConfig } from "next";

const distDir = process.env.AI_USAGE_NEXT_DIST_DIR?.trim() || ".next";

const nextConfig: NextConfig = {
  // The desktop build embeds this standalone server and starts it from Tauri.
  output: "standalone",
  distDir,
  outputFileTracingExcludes: {
    "/*": [
      "./.git/**/*",
      "./.next/**/*",
      "./.next-desktop/**/*",
      "./.desktop-cache/**/*",
      "./desktop-runtime/**/*",
      "./docs/**/*",
      "./scripts/**/*",
      "./src/**/*",
      "./src-tauri/**/*",
      "./tauri-ui/**/*",
      "./coverage/**/*",
      "./*.md",
      "./*.zip",
      "./*.stackdump",
      "./*.tsbuildinfo",
    ],
  },
};

export default nextConfig;
