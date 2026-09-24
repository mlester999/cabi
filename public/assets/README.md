# Cabi brand assets

Place the supplied brand files here using these names:

- `cabi-logo.png` — the supplied official close-up Cabi logo used in headers,
  chat messages, utility surfaces, and browser/PWA icon generation. Keep this
  file optimized because it is reused throughout the app.
- `cabi-cpu-model.png` — the official Cabi character render used for the
  prelaunch hero. 500×500.
- `cabi-main.png` — the higher-resolution Cabi character render (1086×1448),
  used as the hero's only fallback if `cabi-cpu-model.png` cannot load.
- `cabi-mascot.png` — the purple mini Cabi mascot.

The interface reserves stable dimensions. `cabi-logo.png` is the canonical brand
mark and the only mark used for the shared Cabi avatar. The prelaunch hero prefers `cabi-cpu-model.png` and falls back to
`cabi-main.png`; if neither loads, it shows the official logo inside the shared
orb treatment — never a different character.

Browser and PWA icons are committed as real PNG files in `public/`
(`favicon.png`, `cabi-icon-192.png`, `cabi-icon-512.png`,
`apple-touch-icon.png`), so they are served directly and are not derived from the
assets in this folder at build time.
