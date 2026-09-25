# Cabi — Cat Partner Unit

Cabi is a wallet-optional AI companion built as a real **Next.js 16 App Router** application. Its official production deployment is on Vercel at [www.chatwithcabi.fun](https://www.chatwithcabi.fun); the source is Next.js, React 19, TypeScript, Tailwind CSS, route handlers, and Supabase/PostgreSQL.

When the site is live, it opens directly into chat. A wallet is never required to talk to Cabi.

## Product behavior

| Capability | Guest | Connected + SIWE-authenticated EVM wallet |
| --- | --- | --- |
| Chat with Cabi | Yes | Yes |
| Conversation storage | Active tab memory only | Supabase |
| Recent chats and search | Locked | Enabled |
| Rename, pin, delete | No | Enabled |
| Long-term memories | No | Enabled |
| Bond progress | Temporary only | Persisted |
| Preferences and data export | No | Enabled |
| Required network for chat/history | None | None |

Guest transcripts are never written to Supabase, `localStorage`, or IndexedDB. Refreshing or closing the tab may clear them. If a guest connects during an active conversation, Cabi asks **Save Chat** or **Keep Temporary**; no existing transcript is uploaded until **Save Chat** is chosen.

## Stack

- Next.js 16 App Router and React 19
- TypeScript and Tailwind CSS 4
- Supabase/PostgreSQL for authenticated wallet data
- viem for EVM address and signature validation
- EIP-6963/injected providers plus optional Reown WalletConnect
- DeepSeek-compatible Chat Completions or Responses streaming
- Zod validation, Vitest, Testing Library, ESLint
- Vercel production deployment through the native Next.js build

## Architecture

```text
Browser
  ├─ Next.js React UI
  ├─ temporary guest chat held only in component memory
  └─ EIP-1193 wallet provider (optional)
       ├─ eth_requestAccounts
       ├─ personal_sign for SIWE-style login
       └─ wallet_switchEthereumChain / wallet_addEthereumChain

Next.js route handlers
  ├─ secure nonce + signature verification
  ├─ signed, HttpOnly, revocable wallet session
  ├─ explicit wallet-owner predicates on every persisted query
  ├─ DeepSeek stream normalization and cancellation
  ├─ Cabi memory, summaries, Bond, and RAG
  └─ separate protected admin console

Supabase PostgreSQL
  ├─ wallet_accounts, wallet_nonces, auth_sessions, profiles
  ├─ conversations, messages, memories, settings, Bond
  ├─ centrally managed EVM chains and $CPU configuration
  ├─ knowledge, usage, rate limits, encrypted config, audit
  └─ constraints, indexes, RLS, and server-only RPCs
```

There is no transaction execution or token-approval path in the shipped wallet client. Wallet signing is login-only and costs no gas. `$CPU` trading is an external link to the exact owner-configured Clank.trade coin page.

## Wallet authentication

Connecting an address is not treated as authentication. The flow is:

1. Select an injected or WalletConnect-compatible EVM wallet.
2. The server creates a cryptographically random, five-minute, one-time nonce.
3. The wallet signs a human-readable SIWE-style message.
4. The server verifies the address, signature, nonce, domain, URI, statement, issue time, and expiration.
5. The nonce is atomically consumed to prevent replay.
6. A random session token is hashed in PostgreSQL; only its signed bearer value is stored in an HttpOnly cookie.
7. Logout revokes the database session and clears local authenticated state.

The login message never asks for a transaction, approval, transfer, private key, recovery phrase, or seed phrase.

Supported wallet discovery includes MetaMask, Rabby, Coinbase Wallet where it exposes an EIP-6963/EIP-1193 provider, other injected EVM wallets, and WalletConnect-compatible wallets when `NEXT_PUBLIC_REOWN_PROJECT_ID` is configured. This application is EVM-only.

## Supported chains

Chains are owner-managed in `/admin/cpu`; none are invented or seeded. Each chain stores:

- chain ID and name
- native currency name, symbol, and decimals
- HTTPS RPC URL
- verified block explorer URL
- optional icon
- enabled state
- primary-chain state

An unsupported connected chain shows **Wrong network** and **Switch Network**. Saved chat history remains readable regardless of the currently selected wallet network.

## `$CPU`

`/cpu` is the public Cat Partner Unit token page, and `/admin/cpu` controls its data. The token's launch state is independent of the application's site mode.

Unless the admin record is `LIVE` with a complete destination, the public UI shows **Coming Soon** and no contract, price, market cap, or buy link. In `LIVE`, the admin must provide a viem-valid EVM address, an enabled configured chain, and an exact `https://clank.trade/...` coin URL. The UI then shows the contract, copy action, configured network, explorer link, and **Buy $CPU**.

A contract without its Clank.trade coin URL is not treated as publishable: `redactUnlaunchedCpu` in `lib/wallet/config.ts` empties the contract, network, and trade URL for the public projection, so a half-configured token stays in its Coming Soon state rather than showing a bare address.

The Buy button opens the exact stored Clank.trade URL in a new tab with `rel="noopener noreferrer"`. It never derives a URL from a contract and never routes to a generic trading page.

### Published `$CPU` destination

The repository deliberately contains **no** contract address and **no** Clank.trade link. Publishing a token destination is an owner decision, so there are two supported ways to provide it:

1. **`/admin/cpu`** — enter the contract, an enabled chain, and the exact coin URL, then set the launch status to `LIVE`. Stored in `cpu_settings`; changeable without a redeploy.
2. **Deployment variables** — set `CPU_CONTRACT_ADDRESS` and `CPU_CLANK_TRADE_URL`. This is the right choice if you would rather stage the published pair in the hosting environment; they are validated exactly like admin input (a real EVM address, and an exact HTTPS Clank.trade URL), and an admin-entered value always takes priority.

Neither path bypasses the `LIVE` gate, so nothing is shown publicly until you explicitly launch the token.

## `$CPU` holder access gate

While the site is `LIVE`, using the Cabi application requires holding at least **1,000,000 $CPU** in the authenticated wallet. Approved owner/admin wallets are exempt.

The gate is a real server-side authorization layer, not a cosmetic paywall:

- **One configuration file.** `lib/cpu-access/config.ts` holds the official contract `0x1a421a5065316d9b4062939e9959ddece6630528`, chain `4663` (Robinhood Chain), the exact buy page `https://clank.trade/coin/0x1a421a5065316d9b4062939e9959ddece6630528`, and `CPU_MIN_ACCESS_BALANCE = 1000000`. Nothing is scattered into components, and an environment override (`CPU_ACCESS_TOKEN_ADDRESS`, `CPU_ACCESS_CHAIN_ID`, `CPU_ACCESS_RPC_URL`) is accepted only when it parses as a valid address, chain, and HTTPS endpoint.
- **One decision.** `resolveCabiAccess()` in `lib/cpu-access/resolve.ts` answers the question for pages, route handlers, and the status endpoint. Order: site mode → wallet authentication → admin/owner allowlist → `cpu_holder_gate_enabled` → onchain balance.
- **Trusted read.** `lib/cpu-access/balance.server.ts` calls `balanceOf` and `decimals()` through viem against the owner-configured HTTPS RPC. Decimals are read from the contract on every check and never assumed; a missing or absurd answer fails closed. Comparison is `bigint` against `bigint`; no amount that decides access passes through a JavaScript `number`.
- **Nothing from the browser.** A forged balance, a forged `isAdmin`, a query parameter, `localStorage`, or hidden UI state cannot change a decision: the wallet identity comes from the signed HttpOnly session cookie and the balance from the server's own RPC read. Every protected API repeats the check for itself, so hiding the modal or calling `/api/chat` directly changes nothing.
- **Fail closed.** If the chain cannot be read, a normal user is refused with "Cabi couldn't verify your $CPU balance right now." and two actions: **Try Again** and **Open $CPU on Clank.trade**. An admin bypass is evaluated separately and is unaffected.
- **Short-lived cache, explicit rechecks.** A balance is cached for 30 seconds and gate settings for 15. `Check Again`, chat, and image generation read fresh; an open session re-checks on a slow timer and returns to the server-rendered gate if the wallet drops below the minimum.
- **Nothing is deleted.** Losing eligibility only locks access. Chats, memories, images, and the profile stay attached to the wallet.

`/admin/cpu` shows the gate's effective state (enabled, minimum, official contract, buy URL, chain, RPC, admin bypass) with the contract, chain, and buy URL read-only. Editing the minimum or the two switches is server-side only, validated, and written to the audit log as `cpu.access_gate_update`. The analytics events are four coarse values (`cpu_gate_viewed`, `cpu_gate_passed`, `cpu_gate_failed`, `cpu_buy_link_opened`) stored against a salted actor hash — never a balance, and never a wallet address.

PRELAUNCH and the holder gate are separate layers: while the site is in `PRELAUNCH`, normal wallets stay on the prelaunch page no matter how much $CPU they hold, and only an approved admin/owner preview may enter `/preview`.

## Main routes

### Public

- `/` — Cabi chat
- `/settings` — wallet-authenticated preferences, memories, export, and deletion
- `/settings/memory` — what Cabi remembers, with per-memory forget and a memory switch
- `/portfolio` — what the connected wallet holds on the configured network
- `/cabi` — Cabi's profile: mood, bond level, days together, memories
- `/leaderboard` — weekly and monthly rankings, public, username-only
- `/profile` — your rank, lifetime progress, season history, and bond
- `/gallery` — the Cabi images you have generated, with download, regenerate and use-as-picture
- `/u/[username]` — a public profile: lifetime rank, monthly XP and achievements, never a wallet
- `/cpu` — safe prelaunch/live `$CPU` card
- `/api/chat` — guest or authenticated stream (model plus the deterministic action layer)
- `/api/wallet/nonce`, `/verify`, `/session`, `/logout`
- `/api/conversations/*`, `/api/messages/*`, `/api/memories/*`
- `/api/settings`, `/api/data`, `/api/data/export`
- `/api/portfolio` — authenticated wallet snapshot, scoped to the session cookie
- `/api/cabi` — authenticated bond profile and current mood
- `/api/profile` — identity, and the one-time username claim
- `/api/rank` — the session wallet's rank, lifetime totals, and season history
- `/api/images` — Cabi-only image generation, authenticated and rate limited
- `/api/gallery` — the session wallet's own generations
- `/api/leaderboard` — public standings read; no wallet address is ever returned
- `/api/profile/avatar` — set the profile picture from a generation or an upload
- `/api/admin/users/[id]` — per-account progression and the eligibility flag
- `/api/admin/ranking` — seasons, XP adjustment, rewards, and rank tuning
- `/api/public/config` — non-secret supported-chain and `$CPU` configuration
- `/api/cpu/access` — the holder gate's own status for the signed-in wallet, plus the four gate analytics events

`/settings/memory`, `/portfolio`, `/cabi`, `/profile`, and `/gallery` are application
routes, so outside `LIVE` they render the public prelaunch page instead of exposing an
unfinished surface. `/leaderboard` is public by design: it publishes usernames and XP
only, so a visitor can read the standings before connecting a wallet.

### Admin

- `/admin/login`
- `/admin`
- `/admin/ai`
- `/admin/images`
- `/admin/personality`
- `/admin/knowledge`
- `/admin/ranking`
- `/admin/users/[id]` — one account in detail
- `/admin/users`
- `/admin/conversations`
- `/admin/memories`
- `/admin/branding`
- `/admin/cpu`
- `/admin/settings`
- `/admin/audit`

Admin routes never appear in ordinary public navigation and are protected server-side.


## What is open, and what is not

This phase ships five surfaces and presents everything else as intentionally
unreleased. Feature flags are resolved **server-side** from `app_settings` under the
`feature_flags` key; nothing reads a flag from a request body, a query parameter, or
client storage, and an unavailable database resolves to the built-in defaults rather
than to "everything on".

| Flag | Default | Surface |
| --- | --- | --- |
| `chat_enabled` | on | Cabi chat |
| `image_generation_enabled` | on | Cabi image generation |
| `wallet_auth_enabled` | on | EVM wallet connection and sign-in |
| `memory_enabled` | on | Cross-conversation memory |
| `profile_enabled` | on | Name and profile photo |
| `ranking_enabled` | **on** | Lifetime rank tiers and progression |
| `leaderboard_enabled` | **on** | Weekly and monthly boards, public profiles |
| `portfolio_enabled` | **off** | Wallet portfolio view |
| `direct_trading_enabled` | **off** | Trade intents from chat |
| `rewards_enabled` | **off** | Community rewards |
| `gallery_enabled` | **off** | Standalone image gallery |

Admin can inspect and change every flag at `/admin/flags`.

**A locked feature closes both of its entry points.** Locking a page alone is not
enough: the page and the API are separate entry points, so each unfinished route *and*
its endpoint is gated. `featureGate()` answers `404 FEATURE_LOCKED` rather than `403`,
so a locked endpoint does not confirm that it exists.

Locked surfaces appear as "In the works" cards — dark overlay, reduced opacity, lock
icon, no data of any kind, and no link into the unfinished interface. Activating one
shows a short acknowledgement and returns the user to chat. Grep-verified: the locked
card component contains no `href` and no `router.push`.
## Lifetime rank and period leaderboards

Rank is **separate from bond and leaderboard placement**. Bond is the relationship with
Cabi and never resets. Rank advances on lifetime XP and survives weekly and monthly board
resets.

Six lifetime tiers. The admin can tune the thresholds; the defaults are:

| Tier | Key | Lifetime XP |
| --- | --- | --- |
| 1 | Novice | 0 |
| 2 | Familiar | 500 |
| 3 | Companion | 2,000 |
| 4 | Elite | 6,000 |
| 5 | Master | 15,000 |
| 6 | Legend | 35,000 |

**Rank is never tied to wealth.** No input to the XP evaluator comes from token
ownership, wallet balance, trading volume, or spend. A test asserts that no
wealth-related word appears anywhere in the tier model, and the database function that
writes XP accepts only server-computed activity signals.

### How XP is earned

XP is decided by a deterministic, server-side evaluator (`lib/ranking/xp-rules.ts`).
The browser never sends an XP amount, a tier, or a score. Quality bands are recorded
without message bodies; manual adjustments and legacy events are marked as not scored.

| Signal | XP |
| --- | --- |
| Genuine message (≥12 chars, ≥3 words) | +2…+8, scaling with length |
| Long substantive turn (≥220 chars, ≥40 words) | up to +12 |
| Building on the previous turn | +3 |
| Memory interaction | +2 |
| Using a Cabi feature | +2 |
| Below the length/word floor | 0 |
| Near-duplicate of a recent message | 0 |
| Flooding (≥5 messages in 20s) | −2 |
| First Cabi image of the day | +5, then 0 |
| Daily ceiling | 300 (configurable) |

Negative XP is reserved for unambiguous flooding. Short questions, typos, a second
language, emotional conversations, sensitive topics, and disagreeing with Cabi are
explicitly **not** penalised — several are rewarded, because they are the conversations
that matter. When a signal is ambiguous the answer is zero, not a penalty.

Reaching Legend requires **at least 117 days at the daily cap** at the default settings.

### Seasons without a cron job

`rank_seasons` holds both weekly and monthly periods, with XP totals kept separate from
lifetime XP. A partial unique index
(`one ACTIVE row per type`) plus `pg_advisory_xact_lock` means two concurrent requests
cannot both create the next period. Reading the leaderboard finalizes any expired period
first, and finalization is idempotent, so the first read after a deadline rolls the
season over safely. No scheduler is required.

History is never deleted. A closed period keeps its stats, frozen placements, and reward
snapshots, and is simply marked `FINALIZED`. An admin "reset" closes the current period
and opens the next one.

## Image generation

Cabi-only, and enforced before any provider call. The active provider is **Together AI**
(`POST https://api.together.xyz/v1/images/generations`), with **`Qwen/Qwen-Image-2.0`** as
the default model.

- `lib/cabi/image-identity.ts` is the **single source of truth** for Cabi's appearance.
  Every prompt is assembled as `[canonical identity] + [user scene] + [composition]`,
  always in that order, so a scene that tries to describe a different character is
  competing with the canon rather than replacing it. No component restates her
  appearance.
- `lib/ai/image/together.ts` is the Together service. `lib/image-generation/provider.ts`
  keeps the `ImageGenerationProvider` abstraction, so FLUX, GPT Image, Seedream or
  Gemini can be added without touching the UI.
- The provider is **independent of the DeepSeek chat provider**, so one can be down
  without breaking the other.
- Aspect ratios are a closed set — `1:1` (1024×1024), `16:9` (1344×768), `9:16`
  (768×1344) — so a request cannot ask for an extreme resolution.
- Generation requires an authenticated wallet, with a database-counted daily quota.
  A failed provider call is recorded as `FAILED`, which the quota does not count, so an
  outage does not burn the user's allowance.
- Images live in the private `cabi-generations` bucket and are served through
  short-lived signed URLs. Avatars use a separate private `avatars` bucket.
- Normal users never see "Together AI", "Qwen", a model name or a provider error. The
  provider's own error text is logged server-side and replaced with a Cabi line.

### Cabi's official character reference

Cabi must stay recognizably Cabi in every image: her clothes, pose, expression, and
environment change; her identity does not. Two mechanisms keep that true.

**1. The character bible.** `lib/cabi/image-identity.ts` holds the fixed identity —
face, ash-gray hair, gray-lavender eyes, cat ears, adult presentation — and prompts are
assembled from six distinct layers:

```
IDENTITY  →  EXPRESSION  →  OUTFIT  →  SCENE  →  COMPOSITION  →  QUALITY
```

`IDENTITY` is constant and always first. `EXPRESSION` and `OUTFIT` are values from closed
sets, and everything a user writes lands in `SCENE`, where the identity-override guard
strips phrasing such as "make her hair blonde", "give her blue eyes", or "remove her cat
ears" before the prompt is built. A request can therefore change how Cabi looks in the
picture, never who she is. Harmless styling ("blonde highlights", "a black hoodie") passes
through.

**2. The official reference image.** One admin-managed image is Cabi's visual anchor,
resolved by `lib/cabi/reference/resolve.server.ts` in a fixed priority:

1. the active admin-uploaded reference, in the private **`cabi-system-assets`** bucket at
   `official/cabi-reference.png`;
2. the bundled `public/assets/cabi-cpu-model.png`;
3. otherwise a visible failure — never a different character.

It is a **system** asset, not a user asset: it lives in its own bucket, never inside a
wallet's generation folder, and a browser session cannot supply or replace it.

`/admin/images` → **CABI REFERENCE** shows the current image, its status, version, upload
date, dimensions, and storage path, with **Replace Reference**, **View History**, and
**Restore** for any previous version. Replacing archives the old bytes to an immutable
`official/versions/...` path first, and exactly one row is active — enforced by a partial
unique index in the database, not only by application code. Uploads are validated on their
magic bytes (PNG, JPEG, or WebP; 8 MB cap) and audited as `cabi.reference_upload`.

**Reference conditioning depends on the model.** `imageCapabilitiesFor()` derives the
capability from the selected *model*, and the reference is attached automatically whenever
the model supports it — the user never uploads Cabi. The recommended
`Qwen/Qwen-Image-2.0`, premium `Qwen/Qwen-Image-2.0-Pro`, budget `Qwen/Qwen-Image`,
and `black-forest-labs/FLUX.1-kontext-pro` all document Together's `image_url` input.
The budget Qwen option supports reference edits too, while Qwen Image 2.0 remains the
recommended balance for Cabi identity consistency. The admin console derives these
capabilities from the same registry used by the request adapter:

```
Reference Conditioning: SUPPORTED (Qwen Image)
```

The active reference is attached only for models whose registry entry supports it; the
selected model's capability panel updates immediately when the owner changes the dropdown.

Generation metadata recorded per row is safe by construction: `reference_version`,
`expression`, `outfit`, `scene`, `seed`, `reference_conditioned`, provider, model, and
aspect ratio. The prompt layers and the reference path are never stored and never returned
to a client.

### Follow-up image requests

`lib/image-generation/parse-scene.ts` turns a follow-up into the parts the pipeline can
vary, carrying the previous image's scene forward from the wallet's own generations:

| Request | Result |
| --- | --- |
| "Make another one but smiling." | same scene and outfit, expression `smiling` |
| "Now put yourself in a hoodie." | same scene, outfit `hoodie` |
| "Same scene but at night." | same scene plus an "at night" note |
| "Make the outfit black." | same scene and outfit, colour note `black colourway` |

An unknown expression or outfit arriving from a damaged row is dropped rather than passed
through.

## Cabi activity messages

Cabi never shows a generic spinner. `lib/cabi/status-messages.ts` holds one catalogue per
activity — `CHAT_THINKING`, `IMAGE_GENERATING`, `MEMORY_LOADING`, `WALLET_VERIFYING`,
`PROFILE_SAVING`, `IMAGE_SAVING` — and `components/cabi/cabi-activity-status.tsx` is the
single component that renders it, in the chat header and transcript, the wallet connect
dialog, and anywhere else a wait is visible.

- The first line appears immediately; the next follows after 2.5–4 s and every line after
  that lands in a 3–5 s window, varied so the rotation does not read as a metronome.
- **No fake progress.** The bar is an indeterminate sliver; there is no percentage
  anywhere, because no provider reports one.
- Long generations escalate on elapsed time: "Still working on it..." after 15 s, and
  "This one's taking a little longer." after 30 s. Nothing implies failure before a real
  timeout.
- `prefers-reduced-motion` removes the mascot animation and the sliding bar and leaves the
  messages rotating.
- The rotating text is `aria-hidden`; a single stable sentence per activity sits in a
  polite live region, so a screen reader hears "Cabi is processing your request." once
  rather than a new line every three seconds.
- Owner-added lines are **appended** to the built-in defaults, so a category can never end
  up with nothing to say.

`/admin/personality` → **Cabi Activity Messages** shows the shipped lines read-only, lets
the owner add or remove extra ones per category, switch them off entirely, and reset to
defaults. Nothing has to be configured: with no settings row at all, the built-in lines are
what Cabi says. The rotation timing and the long-wait escalation are fixed in code and are
not configurable.

### Cabi-only relevance

A literal search for "Cabi" is not enough, so `classifyCabiRelevance()` returns one of
three verdicts **before any provider call**:

| Verdict | Behaviour |
| --- | --- |
| `CABI_RELATED` | generate |
| `NOT_CABI_RELATED` | refuse, and offer the Cabi version of the same idea |
| `UNCERTAIN` | ask what they want involving her, then generate |

It uses conversation context, so `"put her in a gaming chair"` resolves to Cabi after a
turn about her — but context can never make an unrelated subject relevant. Refusals use
several natural variants, picked deterministically per prompt so behaviour is stable
while different requests vary. A refused request **never contacts the provider**, so no
credit is spent.

### Cost control

One image per request (`n: 1`), a server-side rate limit, a database-counted daily
allowance, an idempotency key so a double-submit reuses the first result instead of
paying twice, a 120-second timeout, and a relevance check that runs before the provider.
The UI disables Generate while a request is in flight.

### Image API key

Two supported locations, in priority order:

1. **`TOGETHER_API_KEY`** in the server environment (recommended).
2. The admin panel at `/admin/images`, encrypted at rest with `APP_ENCRYPTION_KEY` and a
   record-bound AAD in `secret_settings`.

Either way the key is **server-only**: it is read in `lib/ai/image/together.ts` behind
`import "server-only"`, so it cannot be pulled into a client bundle. It is never returned
to a browser, never written to a log, and never prefixed with `NEXT_PUBLIC_`.

### Together AI setup

1. Create or sign in to an account at [together.ai](https://api.together.xyz).
2. Add billing credits — image generation fails with a balance error without them.
3. Generate an API key in the Together dashboard.
4. Add it to `.env.local` (git-ignored) as `TOGETHER_API_KEY=...`.
5. Add the same secret to your hosting provider's environment variables (Vercel →
   Settings → Environment Variables). Never paste it into a source file.
6. Restart locally, or redeploy.
7. Open `/admin/images` and press **Test Connection** — it makes a real generation, so a
   green result means the key, the balance and the model all work.

Optional server-side override: `TOGETHER_IMAGE_MODEL=Qwen/Qwen-Image-2.0-Pro` (the
recommended `Qwen/Qwen-Image-2.0` is used when unset). The owner UI exposes Together AI
only and keeps its official endpoint fixed.

## Cross-conversation memory

Long-term memory is keyed on `wallet_account_id`, never on a conversation, so a fact
learned in one chat is available in every other one.

Three layers are assembled per turn:

1. **Short term** — recent completed messages in this conversation.
2. **Conversation summary** — older context from this conversation.
3. **Long term** — persistent facts for the wallet, selected for *relevance to the
   current message* rather than injected wholesale.

Facts are captured from explicit requests (`remember that …`) and from clear
first-person statements (`my cat is named Luna`). Extraction is a conservative
allowlist: questions are never stored, statements about other people are never stored,
and anything matching the sensitive list is rejected. Conflicts are resolved by key —
`pet:cat` is a single slot, so "my new cat is Max" supersedes "my cat is named Luna"
instead of leaving two contradictory facts.

When memory is switched off, neither the summary nor long-term memory is used, and no
new long-term memory is created.


## Cabi action layer

Cabi answers wallet and token questions with trusted application code, not with the
model. The order of operations in `/api/chat` is:

```text
user message
  → interpretMessage()        deterministic classification (lib/actions/intent.ts)
  → runAction()               trusted execution (lib/actions/runtime.ts)
  → action card               serialisable, validated model (lib/actions/types.ts)
  → reply                     deterministic, or the model when prose is needed
```

What this buys:

- **Slash commands and wallet reads never call the model.** `/cpu`, `/wallet`,
  `/portfolio`, `/help`, "what do I hold?", "do I own $CPU?" are answered by
  application code, so they keep working even when no AI key is configured, cost
  no tokens, and cannot be steered by generated text.
- **Only requests that genuinely need prose** (`memory` phrasing, ordinary
  conversation, and the sentence around a trade card) reach DeepSeek.
- **Action cards are persisted** on the assistant message and re-validated with
  Zod on the way back out, so a tampered or legacy row degrades to plain text and
  can never introduce a `javascript:` or relative link.
- **A trade request produces a card, never a transaction.** The card shows the
  contract, amount, network, and route, plus the exact verified Clank.trade coin
  page. It states plainly that nothing happens until the user confirms it
  themselves.

### Slash commands

`/cpu` `/portfolio` `/wallet` `/memory` `/bond` `/help` `/new` `/settings`

Every command maps to something real: `/portfolio`, `/memory`, `/bond`, and
`/settings` are route links; `/cpu`, `/wallet`, and `/help` are answered by the
action layer; `/new` starts a fresh chat locally. The palette appears only while a
bare `/…` token is in the composer, so it never intrudes on normal typing, and
natural language stays the primary interface.

### Ambiguity and refusal behaviour

- A bare ticker is never treated as an identity. `$CPU` resolves because the owner
  published it; an unknown ticker asks for the contract address.
- A missing amount asks how much rather than assuming one.
- A request naming wallet secrets is refused, not processed.
- A non-Clank.trade link is refused rather than fetched, which removes the SSRF
  surface entirely.

## Wallet data

`lib/wallet-data/` is the single read path for public onchain state. Chat, the
portfolio route, and token cards all go through `readWalletSnapshot`, so RPC
handling, timeouts, error mapping, and caching cannot drift between surfaces.

- Chain configuration always comes from owner settings, never from a request, so
  a caller cannot redirect an RPC call.
- The address always comes from the signed wallet session cookie, never from a
  request body, so the layer cannot be used to read someone else's wallet.
- Results are cached in-process for 20 seconds. No transaction-sensitive data is
  cached, and nothing is written to shared storage.
- Token scope is honest: Cabi reads tokens the **owner configured** (today
  `$CPU`). It does not present a partial log scan as a full portfolio.

### No fabricated market data

This product has no verified price feed, so there is no price, USD value, market
cap, holder count, volume, bonding percentage, slippage, or gas estimate anywhere
in the schema, the cards, or the UI. Balances are shown as quantities. When
metadata cannot be read, the card says so and shows the contract.

## Optional site modes and prelaunch

The default application mode is `PRELAUNCH`, so `/` stays on the prelaunch page until the owner explicitly launches Cabi. The owner may switch to `LIVE` or `MAINTENANCE` from `/admin/settings`, or use the emergency `SITE_MODE_OVERRIDE` environment variable.

The prelaunch hero uses the official character render at `public/assets/cabi-cpu-model.png`, falling back to `public/assets/cabi-main.png`, with responsive desktop/mobile framing, reduced-motion support, and truthful `$CPU` state. If neither asset loads, the reserved frame shows the official Cabi logo rather than substituting a different character.

The page does not show fake progress, a release date, market data, or a fabricated buy link. `$CPU` details appear only after the owner publishes a contract address together with an exact Clank.trade coin URL, and the repository ships neither value — see [Published `$CPU` destination](#published-cpu-destination).

Mode precedence is:

1. `SITE_MODE_OVERRIDE` (server-only emergency override; `SITE_MODE` still works as a deprecated alias)
2. `app_settings.site_mode`, written by `/admin/settings`
3. built-in `PRELAUNCH` (safe fallback)

`SITE_MODE_OVERRIDE` is deliberately not a `NEXT_PUBLIC_` variable because it is an access-control input and must never be inlined into a client bundle.

`/preview` lets an authenticated admin inspect the application while an explicit prelaunch or maintenance mode is active. An explicitly authorized EVM owner wallet can also enter after completing the normal nonce/SIWE signature flow. This is a private exception: it does not change `site_mode`, and an ordinary signed-in wallet still sees prelaunch.

Manage owner preview wallets in **/admin/settings → Owner Wallets**. Adding or removing a wallet requires the existing password-admin session, confirmation, and a valid viem address; changes are audited. The `admin_wallets` table is the primary allowlist. `ADMIN_PREVIEW_WALLETS` is an optional comma-separated, server-only bootstrap list; a database row (including a disabled row) takes precedence. Removing a wallet invalidates preview access on its next request, even if it is also in the environment list. No wallet is automatically promoted.

The four-hour preview cookie is signed, HttpOnly and bound to the revocable wallet session. `/preview` and its feature subroutes reuse the real wallet account and application data, so saved chats, profile, and memories remain with that wallet after launch. Deploy the migrations before adding wallets; the private `cabi-generations` and `avatars` buckets are created by migration `0016`.

## Local setup

Requirements: Node.js 22.13+ and a Supabase project.

```bash
npm ci
copy .env.example .env.local
node scripts/generate-secrets.mjs
npm run dev
```

Apply every SQL file in `supabase/migrations/` in filename order before testing wallet persistence.

Required production values:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
APP_ENCRYPTION_KEY
SESSION_SECRET
APP_URL
ADMIN_EMAIL
ADMIN_PASSWORD_HASH
```

AI can be configured in `/admin/ai` or with `DEEPSEEK_API_KEY` and the related DeepSeek environment variables.

For QR/mobile wallets, create a Reown Cloud project, set `NEXT_PUBLIC_REOWN_PROJECT_ID`, and allowlist the exact local and production origins. `APP_URL` must also be the exact canonical origin because SIWE domain and URI checks are strict.

Never expose `SUPABASE_SERVICE_ROLE_KEY`, `APP_ENCRYPTION_KEY`, `SESSION_SECRET`, DeepSeek keys, or admin credentials through `NEXT_PUBLIC_*` variables.

## Database migrations

1. `0001_extensions_and_private.sql` — extensions and private helpers
2. `0002_identity_and_chat.sql` — original profile/chat schema
3. `0003_memory_and_bond.sql` — memories, Bond, and Cabi state
4. `0004_knowledge.sql` — knowledge sync and search
5. `0005_admin_operations_and_security.sql` — encrypted config, usage, audit, rate limits
6. `0006_wallet_identity_and_persistence.sql` — wallet accounts, nonce/session auth, wallet ownership, supported chains, `$CPU`, and wallet-scoped RPCs
7. `0007_site_mode_and_prelaunch.sql` — optional site modes and prelaunch settings
8. `0008_prelaunch_until_explicit_launch.sql` — moves the old implicit LIVE default back behind prelaunch
9. `0009_knowledge_and_rls_repair.sql` — repairs runtime-only defects in the two migrations above (see below)

Migration `0006` removes only rows owned by the retired anonymous/guest identity model. If it detects any legacy `auth.users`-owned profile, it aborts the transaction instead of guessing a wallet or deleting real data. Export or explicitly backfill those profiles to wallet accounts before retrying, and always back up an existing production database first.

Migration `0009` exists because two defects from earlier migrations only fail at *runtime*, so they applied cleanly and were never noticed:

- `0004` called `public.similarity(...)`, a `pg_trgm` function that Supabase installs in the `extensions` schema. Every `search_knowledge_chunks` call therefore failed, which meant Clank.trade retrieval silently returned nothing. `0009` recreates the function, resolving the trigram function through whichever schema the extension actually lives in.
- `0001` and `0006` read the retired PostgREST GUC `request.jwt.claim.*`, which PostgREST removed in v12. The helpers always returned `NULL`, so every `to authenticated` policy was permanently false. `0009` rewrites both helpers to read `request.jwt.claims`, keeps the legacy name as a fallback, and guards the `::uuid` cast so a malformed claim denies a row instead of raising an error.

### Authorization is scoped in application code, not by RLS

This is important to understand before relying on the policies:

- The application authenticates a custom signed HttpOnly cookie against `public.auth_sessions`, not Supabase Auth.
- Every database read and write goes through the **service-role** client, which bypasses RLS entirely.
- No `anon` or `authenticated` client is ever constructed, so no request carries a JWT and `auth.uid()` is always `NULL`.

RLS is therefore **defence in depth, not the enforcement boundary**. The boundary is the explicit `wallet_account_id` predicate that every user-data route applies after resolving the wallet from the signed cookie. Never trust a wallet or account ID supplied by the browser.

Because the policies cannot currently be exercised, they are best understood as ready for a future direct-client mode rather than as a verified control. If you ever expose the anon key, the claim minting, the `authenticated` grants, and schema `USAGE` on `private` and `extensions` all have to be finished and tested first.

## DeepSeek, memory, and knowledge

The provider keeps request abort and timeout handling active for the complete response body, rejects premature SSE EOF, and does not save incomplete streams as successful replies. Raw upstream errors and keys are never returned to the browser.

Authenticated context includes bounded completed messages, an optional rolling summary, and explicit long-term memories. Turning memory off suppresses both long-term memories and summary recall. Guest context is supplied only from the current React state.

Retrieved webpage content, memories, nicknames, and summaries are passed as lower-priority untrusted reference data; immutable safety/personality rules remain in the system message.

## Verification

```bash
npm run check
npm run build:next
```

`build:next` is the production build configured in `vercel.json` and verifies
the same native Next.js output used by Vercel.

The automated suite covers, among other cases:

- invalid address/signature, wrong signer, altered message, expired/reused nonce, domain mismatch
- revocable wallet sessions and disconnect-local-state clearing
- no transaction/approval RPC methods and no private-key request UI
- unsupported networks and standard chain switching
- guest no-write behavior and authenticated chat writes
- explicit-only guest chat import
- wallet A isolation from wallet B conversations and memories
- safe `$CPU` prelaunch/live rendering and exact-host Clank.trade validation
- AI stream cancellation, split SSE frames, and premature EOF rejection
- site-mode/preview authorization and responsive prelaunch rendering
- Cabi's identity layers: an outfit, expression, or scene change leaves IDENTITY byte-identical; identity-override attempts are stripped; expressions and outfits are closed sets; every follow-up carries its scene forward
- the official reference: bundled fallback, admin override, version history with a single active row, an invalid image rejected on its magic bytes, and the reference attached automatically only when the model supports conditioning
- the activity messages: rotation cadence floors, escalation thresholds, no percentage anywhere, one stable announcement per activity, and reduced motion
- the `$CPU` holder gate: unauthenticated, zero, 999,999.999, exactly 1,000,000, and above; contract-supplied decimals; bigint boundary comparison; forged balance and forged `isAdmin` ignored; valid/invalid/disabled admin wallets; RPC failure, malformed contract responses, and a missing chain all failing closed; fresh rechecks after a wallet switch and after dropping below the threshold; existing data untouched; every protected API and page enforcing the gate; PRELAUNCH before the gate with no holder bypass; and the exact Clank.trade buy link with `target="_blank"`

With `CABI_CPU_ONCHAIN=1`, `tests/cpu-access-onchain.test.ts` additionally performs a real read-only `balanceOf`/`decimals` call against the official contract on Robinhood Chain, for a real holder and for an empty wallet. It sends no transaction and needs no key.

## Deployment

Vercel is the official production platform. Its Git integration deploys the
connected production branch after a push; `vercel.json` selects the native
Next.js framework and `npm run build:next`. The canonical custom domain is
`https://www.chatwithcabi.fun`.

The owner-managed Vercel project already contains the production environment
configuration. Do not infer production configuration from a local checkout or
another host. For Together AI, `/admin/images` can store the key encrypted
using `APP_ENCRYPTION_KEY`; `TOGETHER_API_KEY` is only an environment fallback.

For each production change:

1. Run `npm run check` and `npm run build:next` locally.
2. Commit and push to the connected production branch.
3. Verify the resulting deployment and application flows on Vercel.
4. Confirm supported chains and `$CPU` fields in `/admin/cpu` when those change.

Do not publish a `$CPU` contract or Clank.trade link until independently verified. Cabi never makes buying, holding, wallet balance, or trading activity part of the user's bond.
