# Shared layouts

## `app/layout.tsx`

Root document metadata and dark-mode shell.

```tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cabi — Cat Partner Unit",
  description: "Talk with Cabi, your warm, witty Cat Partner Unit with memory and Clank.trade knowledge.",
  applicationName: "Cabi",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#07070d",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className="dark"><body>{children}</body></html>;
}
```

## Public Cabi shell

`components/cabi/cabi-experience.tsx` is the current public application shell. It renders a three-column desktop composition (conversation sidebar, chat, Cabi presence) and collapses to one chat column with sidebar/profile overlays on smaller screens. The full target source is passed directly to design calls rather than duplicated here.

## Admin shell

`components/admin/admin-shell.tsx` owns the protected admin layout: fixed left navigation, content region, responsive compact navigation, admin identity, and sign-out. It is intentionally separate from the public Chat / $CPU navigation.

