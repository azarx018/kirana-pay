import type { NextConfig } from "next";

// The Nest API stays the single backend. The web app proxies API calls so the
// session cookie is same-origin (no CORS, no cookie tricks).
const API_URL = process.env.API_URL ?? "http://localhost:3000";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      { source: "/v1/:path*", destination: `${API_URL}/v1/:path*` },
      { source: "/health", destination: `${API_URL}/health` },
      { source: "/docs", destination: `${API_URL}/docs` },
      { source: "/docs/:path*", destination: `${API_URL}/docs/:path*` },
      { source: "/docs-json", destination: `${API_URL}/docs-json` },
    ];
  },
};

export default config;
