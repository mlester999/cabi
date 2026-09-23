# Cabi design system

## Product and experience

Cabi is a private-feeling AI companion called the Cat Partner Unit. The core job is immediate, free guest conversation. An authenticated EVM wallet is an optional portable identity that unlocks saved chats, memory, bond progress, settings, and cross-device continuity. Wallet prompts must be calm, clear, and never interrupt the first-use chat path. Signing is described as free and non-transactional. Never request, reference, or imply access to a seed phrase or private key.

The public architecture has two destinations only: Chat and $CPU. Desktop shows the CABI identity at left, those two links, and a compact wallet control at right. Mobile uses the same destinations in an economical header or bottom treatment. Admin routes never appear publicly.

`/cpu` is a lightweight official-information page, not an analytics dashboard. Prelaunch contains no contract, price, market cap, volume, holders, or buy link. Live state shows only admin-configured name, ticker, contract, network, exact Clank.trade URL, explorer URL, description, and related official links.

## Visual language

- Dark companion-space base: `#07070d`, with elevated violet-black surfaces `#0b0912`, `#100d19`, and `#12101c`.
- Primary lavender `#c4b5fd`, supporting lavender `#a78bfa`, accent violet `#8b5cf6`.
- White primary text, `#a8a3b3` body-muted, `#777180` secondary-muted.
- Borders are quiet white or lavender at 6–14% opacity.
- Use Avenir Next / Segoe UI / system sans only. Do not introduce serif or decorative fonts.
- Surfaces are soft and tactile: 16–28px radii, modest glass blur, inset hairline highlight, deep black shadow, rare violet glow.
- Keep composition spacious and controlled. Avoid token-marketing tropes, neon gradients, charts, ticker tapes, exchange grids, and exaggerated Web3 imagery.
- Buttons use white or lavender fills for the primary action and translucent outlined surfaces for secondary actions.
- Icons are lucide-style, 1.5–2px stroke, visually subordinate to labels.

## Motion and accessibility

Motion is ambient and optional: Cabi breathes slowly, orbit details rotate softly, overlays fade/scale, and status transitions stay under 300ms. Honor reduced motion. Controls require visible keyboard focus, semantic labels, 44px mobile targets, and readable AA contrast.

## Required UI states

- Guest: chat works normally; Recent Chats is visibly locked with “Connect your wallet to save your chats.”
- Benefit modal: “Want me to remember our chats?” and “Signing in is free and does not require a transaction.”
- Connecting: wallet choice first, then a human-readable login signature step. Explicitly state that it costs no gas and sends no transaction.
- Authenticated: shortened public address control opens a wallet popover with address, configured network, copy, explorer, and disconnect.
- Unsupported chain: calm “Wrong network” status with Switch Network; saved chat reading must not be blocked solely by network mismatch.
- Post-auth active guest chat: “Save this conversation?” with Save Chat and Keep Temporary. Never upload before Save Chat.
- CPU prelaunch: Cat Partner Unit, `$CPU`, Coming Soon, Cabi line, explanatory copy, and Chat with Cabi. No fabricated links or numbers.
- CPU live: contract with copy feedback, network, Buy $CPU only when exact configured coin URL exists, View Contract only when configured/derivable from verified chain config.

Use ONLY these fonts, colors, spacing principles, and component styles. Do not introduce any fonts, colors, or visual styles not defined here.
