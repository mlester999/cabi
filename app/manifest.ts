import type { MetadataRoute } from "next";

/**
 * Web app manifest.
 *
 * Colors and naming come from the existing brand palette so an installed Cabi
 * shortcut matches the site in both prelaunch and live.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cabi — Cat Partner Unit",
    short_name: "Cabi",
    description:
      "Meet Cabi, your Cat Partner Unit. Chat, build memories, connect your wallet and explore a new kind of digital companion.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#07070d",
    theme_color: "#07070d",
    categories: ["entertainment", "productivity"],
    icons: [
      { src: "/favicon.png", sizes: "64x64", type: "image/png", purpose: "any" },
      { src: "/cabi-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/cabi-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
