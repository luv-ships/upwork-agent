import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@upwork-agent/core", "@upwork-agent/db"]
};

export default nextConfig;
