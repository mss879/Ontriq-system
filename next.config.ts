import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Don't advertise the framework in every response.
  poweredByHeader: false,
  partialPrefetching: true,
  experimental: {
    // Reopening a page within 30 seconds shows it at once, with no server call.
    // Server Actions clear this, and pages with live updates still refresh.
    staleTimes: { dynamic: 30 },
  },
  // PDF libraries run on the server only and must not be bundled for the edge or client.
  serverExternalPackages: ["@react-pdf/renderer", "pdf-lib"],
  turbopack: {
    root: __dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
