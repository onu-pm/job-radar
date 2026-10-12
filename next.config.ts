import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Keep the pipeline-only libraries out of the site bundle.
  serverExternalPackages: ["pg", "unpdf"],
  // The site reads thresholds and the freshness window from config.yaml at runtime.
  outputFileTracingIncludes: { "/**": ["./config.yaml"] },
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }] }];
  },
};

export default nextConfig;
