import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the dev server to be reached through a Cloudflare quick tunnel
  allowedDevOrigins: ["*.trycloudflare.com"],
  // Keep every response (pages and API) out of search engines
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" },
        ],
      },
    ];
  },
};

export default nextConfig;
