import type { NextConfig } from "next";

const EVE_BASE = process.env.EVE_BASE_URL ?? "http://127.0.0.1:2000";

const nextConfig: NextConfig = {
  // Proxy the Eve agent runtime through the Next dev server so the browser can
  // call it same-origin (no CORS). The frontend hits /eve/* and Next forwards
  // to the Eve server on :2000.
  async rewrites() {
    return [
      { source: "/eve/:path*", destination: `${EVE_BASE}/eve/:path*` },
    ];
  },
};

export default nextConfig;
