# Cabi — Cat Partner Unit

Cabi is a wallet-optional AI companion built as a real **Next.js 16 App Router** application. The current `*.chatgpt.site` URL is only its hosting domain; the source is Next.js, React 19, TypeScript, Tailwind CSS, route handlers, and Supabase/PostgreSQL.

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
- Cloudflare Worker-compatible production output through the Vinext deployment adapter

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
- `/u/[username]` — a public profile: rank, season XP and achievements, never a wallet
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
| `ranking_enabled` | **off** | Rank tiers and progression |
| `leaderboard_enabled` | **off** | Weekly and monthly boards, public profiles |
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
## Rank and seasons

Rank is **separate from bond**. Bond is the relationship with Cabi and never resets; rank
is competitive, monthly, and resets with the season.

Six tiers, with default monthly thresholds. Each season freezes the thresholds in force
when it was created, so a later admin edit never rewrites history.

| Tier | Key | Monthly XP |
| --- | --- | --- |
| 1 | Novice | 0 |
| 2 | Explorer | 500 |
| 3 | Companion | 1,500 |
| 4 | Elite | 4,000 |
| 5 | Master | 9,000 |
| 6 | Legend | 18,000 |

**Rank is never tied to wealth.** No input to the XP evaluator comes from token
ownership, wallet balance, trading volume, or spend. A test asserts that no
wealth-related word appears anywhere in the tier model, and the database function that
writes XP accepts only server-computed activity signals.

### How XP is earned

XP is decided by a deterministic, server-side evaluator (`lib/ranking/xp-rules.ts`).
The browser never sends an XP amount, a tier, or a score.

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
| Daily ceiling | 500 (configurable) |

Negative XP is reserved for unambiguous flooding. Short questions, typos, a second
language, emotional conversations, sensitive topics, and disagreeing with Cabi are
explicitly **not** penalised — several are rewarded, because they are the conversations
that matter. When a signal is ambiguous the answer is zero, not a penalty.

Reaching Legend requires **at least 30 days at the daily cap**, which a test asserts.

### Seasons without a cron job

`rank_seasons` holds both weekly and monthly periods. A partial unique index
(`one ACTIVE row per type`) plus `pg_advisory_xact_lock` means two concurrent requests
cannot both create the next period. Reading the leaderboard finalizes any expired period
first, and finalization is idempotent, so the first read after a deadline rolls the
season over safely. No scheduler is required.

History is never deleted. A closed period keeps its stats, frozen placements, and reward
snapshots, and is simply marked `FINALIZED`. An admin "reset" closes the current period
and opens the next one.

## Image generation

Cabi-only, and enforced before any provider call.

- `lib/image-generation/` holds the character specification, scope guard, provider
  adapters (OpenAI-compatible, Stability, custom), and storage.
- The provider is **independent of the DeepSeek chat provider**, so one can be down
  without breaking the other.
- Every generation prompt is built from `CABI_CHARACTER_BIBLE`, which encodes the
  official traits (ash-gray hair, cat ears, gray-lavender eyes, tail, lavender palette,
  CPU branding). The bible is never returned to a client.
- `"Generate a Lamborghini"` is refused and redirected to `"Cabi lamborghini"`;
  `"Generate Cabi standing beside a Lamborghini"` is allowed.
- Generation requires an authenticated wallet, with a database-counted daily quota.
  A failed provider call is recorded as `FAILED`, which the quota does not count, so an
  outage does not burn the user's allowance.
- Images live in the private `cabi-generations` bucket and are served through
  short-lived signed URLs. Avatars use a separate private `avatars` bucket.

### Image API key

Write-only, encrypted at rest with `APP_ENCRYPTION_KEY` and a record-bound AAD in
`secret_settings`. Reads expose only `hasApiKey` and the last four characters. The key
is never returned to a browser and never logged.

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

`/preview` lets an authenticated admin inspect the application while an explicit prelaunch or maintenance mode is active.

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
npm run build
```

`build:next` verifies the native Next.js production output. The canonical
`build` command then creates the Cloudflare Worker bundle expected by the
current OpenAI Sites deployment target.

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

## Deployment

The current deployment uses OpenAI Sites, which assigns the `*.chatgpt.site` domain and runs the Cloudflare Worker-compatible build. That does not change the framework: the repository remains a Next.js application. Hosting can later move to Vercel or a custom domain without redesigning the product; update `APP_URL`, the Reown origin allowlist, and deployment secrets together.

Vercel uses `vercel.json` to run the native `next build` command and publish `.next`. OpenAI Sites continues to use the Vinext/Worker build from `npm run build`.

Before production publication:

1. Apply the Supabase migrations.
2. Configure production secrets and exact `APP_URL`.
3. Configure Reown if WalletConnect is desired.
4. Configure/test DeepSeek and admin access.
5. Verify supported chains and `$CPU` fields in `/admin/cpu`.
6. Run `npm run check` and `npm run build`.

Do not publish a `$CPU` contract or Clank.trade link until independently verified. Cabi never makes buying, holding, wallet balance, or trading activity part of the user's bond.
