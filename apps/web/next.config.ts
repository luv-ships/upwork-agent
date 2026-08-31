import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    deviceSizes: [640, 750, 828, 1080, 1200, 1600, 1920],
    formats: ["image/webp"],
    qualities: [90]
  },
  output: "standalone",
  transpilePackages: ["@upwork-agent/core", "@upwork-agent/db"]
};

export default nextConfig;
