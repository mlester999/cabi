import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self' https: wss:",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join("; ");
    return [{
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
      ],
    }, {
      // The admin live preview is the only place an installed EVM wallet is
      // expected to be a browser extension, so its popups must be allowed to
      // keep an opener reference. Public pages keep the strict default.
      source: "/preview/:path*",
      headers: [{ key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }],
    }, {
      source: "/preview",
      headers: [{ key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }],
    }];
  },
};

export default nextConfig;
