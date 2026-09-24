import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Cabi — Cat Partner Unit";

/**
 * Composed share card.
 *
 * It is intentionally typographic: the owner has not yet supplied
 * `cabi-main.png`, and generating a stand-in character would misrepresent the
 * product. The card therefore uses Cabi's own palette and wordmark, which stays
 * correct whether the site is in prelaunch or live.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background:
            "radial-gradient(900px 620px at 18% 12%, rgba(139,92,246,0.34), transparent 62%), radial-gradient(760px 520px at 88% 88%, rgba(196,181,253,0.20), transparent 66%), #07070D",
          color: "#ffffff",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "22px" }}>
          <div
            style={{
              width: 74,
              height: 74,
              borderRadius: 22,
              background: "linear-gradient(160deg, rgba(196,181,253,0.22), rgba(139,92,246,0.10))",
              border: "1px solid rgba(196,181,253,0.30)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: "-0.06em",
              color: "#DDD6FE",
            }}
          >
            CA
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: "0.30em" }}>CABI</span>
            <span style={{ marginTop: 8, fontSize: 17, letterSpacing: "0.26em", color: "#A78BFA" }}>CAT PARTNER UNIT</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 82, fontWeight: 700, letterSpacing: "-0.045em", lineHeight: 1.04 }}>
            Cabi is getting ready.
          </span>
          <span style={{ marginTop: 26, fontSize: 30, lineHeight: 1.42, color: "#B9B3C6", maxWidth: 900 }}>
            Chat, memories, wallet identity, and verified $CPU information.
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 22, color: "#8E889B" }}>Cute, loyal, and always by your side.</span>
          <span
            style={{
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: "0.18em",
              color: "#160F27",
              background: "#C4B5FD",
              padding: "14px 26px",
              borderRadius: 999,
            }}
          >
            $CPU
          </span>
        </div>
      </div>
    ),
    size,
  );
}
