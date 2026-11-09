import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the dev server hydrate when opened as 127.0.0.1 rather than localhost.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
