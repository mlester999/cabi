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

`/cpu` is the public Cat Partner Unit token page, and `/admin/cpu` controls its data.

In `PRELAUNCH`, the public UI shows **Coming Soon** and no contract, price, market cap, or buy link. In `LIVE`, the admin must provide a viem-valid EVM address, an enabled configured chain, and an exact `https://clank.trade/...` coin URL. The UI then shows the contract, copy action, configured network, explorer link, and **Buy $CPU**.

The Buy button opens the exact stored Clank.trade URL in a new tab with `rel="noopener noreferrer"`. It never derives a URL from a contract and never routes to a generic trading page.

## Main routes

### Public

- `/` — Cabi chat
- `/settings` — wallet-authenticated preferences, memories, export, and deletion
- `/cpu` — safe prelaunch/live `$CPU` card
- `/api/chat` — guest or authenticated DeepSeek stream
- `/api/wallet/nonce`, `/verify`, `/session`, `/logout`
- `/api/conversations/*`, `/api/messages/*`, `/api/memories/*`
- `/api/settings`, `/api/data`, `/api/data/export`
- `/api/public/config` — non-secret supported-chain and `$CPU` configuration

### Admin

- `/admin/login`
- `/admin`
- `/admin/ai`
- `/admin/personality`
- `/admin/knowledge`
- `/admin/users`
- `/admin/conversations`
- `/admin/memories`
- `/admin/branding`
- `/admin/cpu`
- `/admin/settings`
- `/admin/audit`

Admin routes never appear in ordinary public navigation and are protected server-side.

## Optional site modes and prelaunch

The default application mode is `PRELAUNCH`, so `/` stays on the prelaunch page until the owner explicitly launches Cabi. The owner may switch to `LIVE` or `MAINTENANCE` from `/admin/settings` or use the emergency `SITE_MODE` environment override.

The prelaunch page uses the exact supplied transparent character artwork at `public/assets/cabi-main.png`, with responsive desktop/mobile framing, reduced-motion support, and truthful `$CPU` state. If the asset cannot load, the reserved frame falls back to a neutral Cabi monogram rather than substituting a different character. The page does not show fake progress, a release date, a contract, market data, or a buy link.

Mode precedence is:

1. `SITE_MODE` or `NEXT_PUBLIC_SITE_MODE`
2. `app_settings.site_mode`
3. built-in `PRELAUNCH` (safe fallback)

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

Migration `0006` removes only rows owned by the retired anonymous/guest identity model. If it detects any legacy `auth.users`-owned profile, it aborts the transaction instead of guessing a wallet or deleting real data. Export or explicitly backfill those profiles to wallet accounts before retrying, and always back up an existing production database first.

The server uses the Supabase service client, so every route also applies an explicit `wallet_account_id` predicate even though RLS policies exist. Never trust a wallet/account ID supplied by the browser.

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

Before production publication:

1. Apply the Supabase migrations.
2. Configure production secrets and exact `APP_URL`.
3. Configure Reown if WalletConnect is desired.
4. Configure/test DeepSeek and admin access.
5. Verify supported chains and `$CPU` fields in `/admin/cpu`.
6. Run `npm run check` and `npm run build`.

Do not publish a `$CPU` contract or Clank.trade link until independently verified. Cabi never makes buying, holding, wallet balance, or trading activity part of the user's bond.
