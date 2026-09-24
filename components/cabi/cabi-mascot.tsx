"use client";

/**
 * Cabi's animated prelaunch companion.
 *
 * The official logo is the supplied close-up artwork rendered by `MiniCabi`.
 * This separate vector remains a lightweight decorative status mascot so the
 * prelaunch page can blink, twitch an ear, and wag a tail without a network
 * request or a broken-image state.
 */
export function CabiMascot({ className = "", tail = true, animated = true }: { className?: string; tail?: boolean; animated?: boolean }) {
  const motion = animated ? "" : "cabi-anim-paused";
  return (
    <svg
      viewBox="0 0 100 100"
      className={`${className} ${motion}`}
      role="img"
      aria-label="Cabi, the purple Cat Partner Unit mascot"
      style={{ overflow: "visible" }}
    >
      <defs>
        <linearGradient id="cabi-mascot-body" x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="#b7b2c2" />
          <stop offset="46%" stopColor="#c4b5fd" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
        <linearGradient id="cabi-mascot-ear" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c4b5fd" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
        <radialGradient id="cabi-mascot-cheek" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#c4b5fd" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0" />
        </radialGradient>
      </defs>

      {tail && (
        <path
          className="cabi-mascot-tail"
          d="M77 76c11-1 18-8 18-16 0-5-4-8-8-6"
          fill="none"
          stroke="url(#cabi-mascot-ear)"
          strokeWidth="5.4"
          strokeLinecap="round"
        />
      )}

      <g className="cabi-mascot-bob">
        <path className="cabi-mascot-ear" d="M21 26 17 5l20 10z" fill="url(#cabi-mascot-ear)" />
        <path className="cabi-mascot-ear cabi-mascot-ear-right" d="M79 26 83 5 63 15z" fill="url(#cabi-mascot-ear)" />
        <path d="M26 22 23 11l10 5z" fill="#c4b5fd" opacity="0.4" />
        <path d="M74 22 77 11l-10 5z" fill="#c4b5fd" opacity="0.4" />

        <rect x="13" y="19" width="74" height="66" rx="26" fill="url(#cabi-mascot-body)" />
        <rect x="13" y="19" width="74" height="66" rx="26" fill="none" stroke="#ffffff" strokeOpacity="0.34" strokeWidth="1.4" />
        <rect x="21" y="30" width="58" height="26" rx="13" fill="#ffffff" opacity="0.07" />

        <ellipse cx="27" cy="60" rx="8" ry="5.5" fill="url(#cabi-mascot-cheek)" />
        <ellipse cx="73" cy="60" rx="8" ry="5.5" fill="url(#cabi-mascot-cheek)" />

        <g>
          <ellipse cx="37" cy="52" rx="5.6" ry="6.6" fill="#1b1430" />
          <ellipse cx="63" cy="52" rx="5.6" ry="6.6" fill="#1b1430" />
          <circle cx="38.9" cy="49.4" r="1.9" fill="#ffffff" opacity="0.95" />
          <circle cx="64.9" cy="49.4" r="1.9" fill="#ffffff" opacity="0.95" />
          <circle cx="35.6" cy="55.2" r="1" fill="#c4b5fd" opacity="0.75" />
          <circle cx="61.6" cy="55.2" r="1" fill="#c4b5fd" opacity="0.75" />
        </g>
        {/* An opacity-animated layer paints closed eyes over the open ones. The
            resting frame is a wide-awake cat, so the mascot still reads
            correctly when animations are disabled entirely. */}
        <g className="cabi-mascot-eyelid">
          <path d="M31.6 52.4q5.4-4.6 10.8 0" stroke="#3b2a63" strokeWidth="2.1" fill="none" strokeLinecap="round" />
          <path d="M57.6 52.4q5.4-4.6 10.8 0" stroke="#3b2a63" strokeWidth="2.1" fill="none" strokeLinecap="round" />
        </g>

        <path d="M46.4 63.4h7.2l-3.6 3.2z" fill="#8b5cf6" />
        <path d="M50 66.6v2.6" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        <path d="M50 69.2c-2.3 0-3.9-1.2-4.6-2.4M50 69.2c2.3 0 3.9-1.2 4.6-2.4" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" fill="none" />

        <g stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1.2" strokeLinecap="round">
          <path d="M18 61h-9M19.5 66.5l-8.4 3.2M23 71.4l-6.2 5.8" />
          <path d="M82 61h9M80.5 66.5l8.4 3.2M77 71.4l6.2 5.8" />
        </g>
      </g>
    </svg>
  );
}
