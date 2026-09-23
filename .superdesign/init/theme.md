# Theme

## Compact token summary

- Background: `#07070d`; elevated surfaces: `#0b0912`, `#100d19`, `#12101c`.
- Foreground: `#ffffff`; body-muted: `#a8a3b3`; deeper muted: `#777180`, `#625d6d`.
- Primary lavender: `#c4b5fd`; secondary lavender: `#a78bfa`; accent violet: `#8b5cf6`.
- Success: emerald-300; destructive: `#fb7185`.
- Borders: translucent lavender/white at roughly 6–14% opacity.
- Font: `Avenir Next`, Avenir, `Segoe UI`, system UI; mono: SFMono/Consolas.
- Radius base: `1rem`; frequent product surfaces use 20–28px radii and pill radii for compact status.
- Shadows are deep black with subtle violet glow; glass surfaces use blur and an inset white highlight.
- Responsive breakpoints use Tailwind defaults; chat layout switches from three to two columns at `lg`, then to a single column at `md`.
- Motion: quiet 6.8s Cabi breathing and 28s orbit; all motion honors `prefers-reduced-motion`.

## Raw global source

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "../vendor/shadcn-tailwind-4.13.0.css";

:root {
  --background: #07070d; --foreground: #ffffff; --card: #100d19; --card-foreground: #ffffff;
  --popover: #12101c; --popover-foreground: #ffffff; --primary: #c4b5fd; --primary-foreground: #160f27;
  --secondary: #1a1625; --secondary-foreground: #ddd6fe; --muted: #17131f; --muted-foreground: #a8a3b3;
  --accent: #8b5cf6; --accent-foreground: #ffffff; --destructive: #fb7185;
  --border: rgba(196,181,253,.14); --input: rgba(255,255,255,.1); --ring: #a78bfa; --radius: 1rem;
  --sidebar: #0b0912; --sidebar-foreground: #ffffff; --sidebar-primary: #c4b5fd; --sidebar-primary-foreground: #160f27;
  --sidebar-accent: #171320; --sidebar-accent-foreground: #ffffff; --sidebar-border: rgba(196,181,253,.12); --sidebar-ring: #a78bfa;
}

@theme inline {
  --color-background: var(--background); --color-foreground: var(--foreground); --color-card: var(--card); --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover); --color-popover-foreground: var(--popover-foreground); --color-primary: var(--primary); --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary); --color-secondary-foreground: var(--secondary-foreground); --color-muted: var(--muted); --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent); --color-accent-foreground: var(--accent-foreground); --color-destructive: var(--destructive); --color-border: var(--border);
  --color-input: var(--input); --color-ring: var(--ring); --radius-sm: calc(var(--radius) - 6px); --radius-md: calc(var(--radius) - 3px); --radius-lg: var(--radius); --radius-xl: calc(var(--radius) + 8px);
  --font-sans: "Avenir Next", Avenir, "Segoe UI", system-ui, sans-serif; --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}

* { box-sizing: border-box; }
html { background: #07070d; }
body { margin: 0; min-width: 320px; min-height: 100vh; color: var(--foreground); background: radial-gradient(circle at 78% 18%, rgba(139,92,246,.10), transparent 28rem), radial-gradient(circle at 35% 105%, rgba(196,181,253,.05), transparent 30rem), #07070d; font-family: var(--font-sans); text-rendering: optimizeLegibility; }
button, textarea, input { font: inherit; }
.glass { background: linear-gradient(145deg,rgba(20,16,31,.82),rgba(11,9,18,.74)); border: 1px solid rgba(196,181,253,.13); box-shadow: inset 0 1px 0 rgba(255,255,255,.035),0 22px 60px rgba(0,0,0,.24); backdrop-filter: blur(22px); }
.focus-ring:focus-visible { outline:2px solid #c4b5fd; outline-offset:3px; }
@keyframes cabi-breathe { 0%,100% { transform:translateY(0) scale(1); } 50% { transform:translateY(-6px) scale(1.012); } }
@keyframes cabi-orbit { to { transform:rotate(360deg); } }
.cabi-breathe { animation:cabi-breathe 6.8s ease-in-out infinite; transform-origin:50% 80%; }
.cabi-orbit { animation:cabi-orbit 28s linear infinite; }
@media (prefers-reduced-motion: reduce) { *,*::before,*::after { scroll-behavior:auto!important; animation-duration:.01ms!important; animation-iteration-count:1!important; transition-duration:.01ms!important; } }
```

There is no Tailwind config file; Tailwind v4 configuration is expressed through `@theme` in `app/globals.css`.

