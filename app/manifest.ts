import type { MetadataRoute } from "next";

/**
 * Web app manifest: lets Android and desktop browsers offer "Install", and is
 * what iOS reads once the app is added to the Home Screen (iOS won't allow
 * push until then). Colors match the theme tokens in globals.css.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Shipmate",
    short_name: "Shipmate",
    description:
      "Watches job sources, matches postings to your searches, and tracks your applications.",
    start_url: "/inbox",
    scope: "/",
    display: "standalone",
    background_color: "#f8f3e8",
    theme_color: "#1f2a4d",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
