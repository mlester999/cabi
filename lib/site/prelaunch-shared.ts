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
  subheadline: "Your Cat Partner Unit is still working on the tech.",
  description:
    "Soon you'll be able to talk with Cabi, build your friendship, save your memories, connect your wallet, and learn about Clank.trade and $CPU.",
  statusLabel: "CABI SYSTEM",
  announcement: "",
  xUrl: "",
  communityUrl: "",
  showSocial: true,
  showCpu: true,
  cpuStatus: "PRELAUNCH",
  featureChips: ["Chat", "Memory", "Wallet", "Clank.trade"],
};
