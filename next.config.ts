import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // CLAUDE.md is the vault-authored master copy and is git-ignored; don't let
  // `next dev` write its auto-generated agent-rules block into AGENTS.md.
  // Next bundles its own docs at node_modules/next/dist/docs/.
  agentRules: false,
  // The resume preview is a sandboxed iframe (an opaque origin), and fonts
  // load with CORS: let it use the bundled resume font.
  async headers() {
    return [
      {
        source: "/fonts/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
