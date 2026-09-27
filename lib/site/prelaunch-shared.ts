/**
 * Isomorphic prelaunch copy defaults.
 *
 * `lib/site/prelaunch.ts` is `server-only` (it reads the database), so the
 * defaults and the shape live here where the admin panel and the Zod schema can
 * both use them without pulling in server code.
 */
export type PrelaunchSettings = {
  headline: string;
  subheadline: string;
  description: string;
  statusLabel: string;
  announcement: string;
  xUrl: string;
  communityUrl: string;
  showSocial: boolean;
  showCpu: boolean;
  cpuStatus: "PRELAUNCH" | "LIVE";
  featureChips: string[];
};

export const defaultPrelaunchSettings: PrelaunchSettings = {
  headline: "Cabi is getting ready.",
  subheadline: "The public Cabi experience is still in prelaunch.",
  description:
    "I'm getting the room ready. My public chat, images, memory, and wallet features will open when the owner launches Cabi. The official $CPU coin page is available below.",
  statusLabel: "CAT PARTNER UNIT",
  announcement: "",
  xUrl: "",
  communityUrl: "",
  showSocial: true,
  showCpu: true,
  cpuStatus: "PRELAUNCH",
  featureChips: ["Chat", "Memory", "Wallet", "Clank.trade"],
};
