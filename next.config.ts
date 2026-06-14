import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable Node.js modules in API routes
  serverExternalPackages: ["@steipete/sweet-cookie"],
  // Configure webpack to resolve .js extensions to .ts files
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
