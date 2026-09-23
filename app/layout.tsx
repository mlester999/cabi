import type { Metadata, Viewport } from "next";
import { WalletProvider } from "@/components/wallet/wallet-provider";
import { veilAttribute, veilFadeMs, veilStorageKey, veilTimeoutMs } from "@/lib/site/veil";
import { env } from "@/lib/config/env";
import "./globals.css";

const siteTitle = "Cabi — Cat Partner Unit";
const siteDescription =
  "Meet Cabi, your Cat Partner Unit. Chat, build memories, connect your wallet and explore a new kind of digital companion.";
const fallbackPublicOrigin = "https://cabi-cat-partner-unit.acakmarklester33.chatgpt.site";

/**
 * Canonical origin for meta tags.
 *
 * `APP_URL` is authoritative when the owner sets it. On Vercel the platform
 * exposes the deployment host, so preview builds get correct absolute
 * OpenGraph/Twitter URLs without any extra configuration. Falling back here
 * avoids the "metadataBase property is not set" warning and stops social cards
 * from resolving against localhost in production.
 */
function canonicalUrl(): URL | undefined {
  const configured = env("APP_URL")
    ?? env("VERCEL_PROJECT_PRODUCTION_URL")
    ?? env("VERCEL_URL")
    ?? fallbackPublicOrigin;
  const withProtocol = /^https?:\/\//u.test(configured) ? configured : `https://${configured}`;
  try {
    return new URL(withProtocol);
  } catch {
    return new URL(fallbackPublicOrigin);
  }
}

const metadataBase = canonicalUrl();

export const metadata: Metadata = {
  metadataBase,
  title: { default: siteTitle, template: "%s · Cabi" },
  description: siteDescription,
  applicationName: "Cabi",
  keywords: ["Cabi", "Cat Partner Unit", "CPU", "AI companion", "EVM wallet", "Clank.trade"],
  alternates: metadataBase ? { canonical: "/" } : undefined,
  icons: {
    icon: [
      { url: "/favicon.png", type: "image/png", sizes: "64x64" },
      { url: "/cabi-icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    shortcut: "/favicon.png",
    apple: [{ url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    siteName: "Cabi",
    title: siteTitle,
    description: siteDescription,
    ...(metadataBase ? {
      url: "/",
      images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Cabi — Cat Partner Unit" }],
    } : {}),
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    ...(metadataBase ? { images: ["/opengraph-image"] } : {}),
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#07070d",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * Branded first-paint veil bootstrap.
 *
 * It runs before first paint and only on the first visit of a browser session,
 * which lets the veil be hidden in the server markup (so hydration always
 * matches) while still appearing instantly instead of after hydration.
 */
const veilScript = `(function(){try{var r=document.documentElement;if(sessionStorage.getItem(${JSON.stringify(veilStorageKey)}))return;sessionStorage.setItem(${JSON.stringify(veilStorageKey)},"1");r.setAttribute(${JSON.stringify(veilAttribute)},"");window.setTimeout(function(){r.removeAttribute(${JSON.stringify(veilAttribute)});},${veilTimeoutMs + veilFadeMs + 900});}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: veilScript }} />
      </head>
      <body><WalletProvider>{children}</WalletProvider></body>
    </html>
  );
}
