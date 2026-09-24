import { PreviewBanner, type PreviewChromeMode } from "@/components/prelaunch/preview-banner";
import { readAdminSession } from "@/lib/security/session";
import { getSiteMode } from "@/lib/site/mode";
import { readOwnerPreviewAuth } from "@/lib/site/owner-preview";
import { isPreviewActive } from "@/lib/site/preview";
import { redirect } from "next/navigation";

/** Shared server boundary and banner for every private preview page. */
export async function PreviewApplication({ children }: { children: React.ReactNode }) {
  const { mode } = await getSiteMode();
  const owner = mode === "PRELAUNCH" ? await readOwnerPreviewAuth() : null;
  const admin = await readAdminSession().catch(() => null);
  const adminPreview = admin ? await isPreviewActive().catch(() => false) : false;
  if (!owner && !adminPreview) redirect(admin ? "/preview/start" : "/");

  const chromeMode: PreviewChromeMode = mode === "LIVE" ? "LIVE" : mode === "MAINTENANCE" ? "MAINTENANCE" : "PRELAUNCH";
  const actor = owner
    ? { kind: "wallet" as const, label: `${owner.walletAddress.slice(0, 6)}…${owner.walletAddress.slice(-4)}` }
    : { kind: "admin" as const, label: admin!.email };
  return <><PreviewBanner mode={chromeMode} actor={actor} />{children}</>;
}
