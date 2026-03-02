import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // CLAUDE.md is the vault-authored master copy and is git-ignored; don't let
  // `next dev` write its auto-generated agent-rules block into AGENTS.md.
  // Next bundles its own docs at node_modules/next/dist/docs/.
  agentRules: false,
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
