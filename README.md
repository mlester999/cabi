# Cabi — Cat Partner Unit

Cabi is a production-oriented AI companion experience: a warm, witty Cat Partner Unit with real DeepSeek streaming, server-owned guest sessions, layered conversation memory, grounded Clank.trade answers, a healthy Bond system, and a separate secure admin console.

The root route opens directly into the companion experience. There is no marketing gate and no simulated chatbot. If DeepSeek or Supabase is not configured, Cabi shows a clear configuration state instead of fabricating a reply or pretending data was saved.

## What is included

- Responsive three-panel desktop chat and native-feeling full-screen mobile chat.
- Supplied-artwork integration for `cabi-main.png` and `cabi-mascot.png`, including restrained breathing/glow animation and neutral monogram fallbacks.
- Real server-side DeepSeek streaming through a provider abstraction supporting Chat Completions and Responses-style SSE.
- Persistent conversations, message retry/edit/delete, reactions, safe Markdown, source links, stop generation, and share cards in square and 16:9 formats.
- Three memory layers: recent messages, rolling summary storage, and explicit long-term memories with view/delete/disable controls.
- Healthy, daily-capped Bond events that never reward purchases or punish absence.
- Same-domain Clank.trade crawler with robots checks, redirect revalidation, URL/size/depth limits, content hashing, deduplication, chunking, PostgreSQL full-text/trigram search, and prompt-injection boundaries.
- Separate admin login and protected routes for AI, personality, knowledge, users, conversations, memories, branding, `$CPU`, app settings, and append-only audit logs.
- AES-256-GCM encryption for admin-saved DeepSeek keys. Decrypted keys are never returned to the browser.
- Zod validation, signed HttpOnly guest/admin cookies, same-origin mutation checks, rate limiting, ownership predicates, CSP/security headers, Supabase RLS, and sanitized Markdown.
- Actual PostgreSQL migrations and automated unit/contract tests.

## Architecture

```text
Browser
  ├─ Next/Vinext UI (React 19, Tailwind 4, Motion)
  └─ same-origin route handlers only
       ├─ signed guest/admin sessions
       ├─ Supabase service repository with explicit owner predicates
       ├─ DeepSeek provider + normalized SSE stream
       ├─ memory and Bond services
       └─ Clank crawler / search / RAG pipeline

Supabase PostgreSQL
  ├─ user-owned chat, settings, memory, Bond, and state
  ├─ knowledge documents, chunks, and sync runs
  ├─ encrypted settings, usage, rate-limit buckets, and audit
  └─ RLS + least-privilege grants + server-only RPCs
```

The Sites/Vinext runtime is Cloudflare Worker-compatible. Server code uses `fetch`, Web Streams, and Web Crypto; it does not rely on native database sockets or filesystem persistence.

## Routes

### User product

- `/` — Cabi chat experience
- `/settings` — appearance, memory, sound, data export/deletion, and About
- `/api/chat` — authenticated server-side DeepSeek stream
- `/api/conversations/*` — owned conversation history
- `/api/messages/*` — owned message edit/delete/reactions
- `/api/memories/*` — memory view/delete/clear
- `/api/settings` — user preferences
- `/api/data/export` and `/api/data` — export and deletion

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

Every admin page is protected server-side. Admin mutations repeat authorization checks in their route handler and write an audit record where applicable.

## Local setup

Requirements: Node.js 22.13 or newer and a Supabase project.

1. Install dependencies:

   ```bash
   npm ci
   ```

2. Copy `.env.example` to `.env.local`.

3. Generate strong local secrets:

   ```bash
   node scripts/generate-secrets.mjs
   ```

   Copy the printed values into `.env.local`. To generate an admin password hash in the same command, temporarily set `CABI_ADMIN_PASSWORD` in your shell, run the script, then remove that shell variable.

4. Apply every SQL file in `supabase/migrations/` in filename order using the Supabase CLI or SQL editor.

5. Fill the Supabase URL, publishable key, and service-role key in `.env.local`.

6. Start Cabi:

   ```bash
   npm run dev
   ```

The supplied brand art belongs in `public/assets/`; see `public/assets/README.md`. Exact expected filenames are `cabi-main.png`, `cabi-mascot.png`, and optional design-only `cpu-reference.png`.

## Supabase and database migrations

The application uses Supabase/PostgreSQL as its only durable product datastore. The starter D1 files are retained only because the Sites starter tooling references them; `.openai/hosting.json` deliberately leaves D1 and R2 unbound.

Migrations:

1. `0001_extensions_and_private.sql` — extensions, private schema, ownership/update helpers.
2. `0002_identity_and_chat.sql` — profiles, settings, conversations, messages, reactions, summaries, indexes, grants, and RLS.
3. `0003_memory_and_bond.sql` — memories, Bond events/profiles, Cabi state, daily-diminishing Bond RPC, and RLS.
4. `0004_knowledge.sql` — sync runs, documents, chunks, full-text/trigram indexes, and search RPC.
5. `0005_admin_operations_and_security.sql` — admin/config/secrets, usage, audit, atomic rate limits, deletion RPC, audit immutability, and safe default branding.

The browser never supplies a trusted owner ID. The BFF derives the profile from a signed HttpOnly cookie and applies an owner predicate to every user-data operation. RLS also exists for future authenticated/direct-client access; assistant/system writes and all admin/knowledge/secret tables remain service-only.

## Admin setup

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH`. The password hash format is:

```text
pbkdf2-sha256$310000$<base64url-salt>$<base64url-derived-key>
```

`scripts/generate-secrets.mjs` creates this safely when `CABI_ADMIN_PASSWORD` is set. Admin sessions use a separate signed HttpOnly cookie, short expiry, same-origin checks, and login throttling. For a public production deployment, place the admin console behind an additional platform access policy and add MFA through Supabase Auth or the deployment identity layer.

## DeepSeek configuration

Preferred setup:

1. Sign in to `/admin/ai`.
2. Enter the API base URL and key.
3. Leave Model blank to query DeepSeek's current model list, or select an explicit model.
4. Use **Test connection**.
5. Save.

The key is encrypted with AES-256-GCM using `APP_ENCRYPTION_KEY`, a fresh 12-byte IV, and record-bound authenticated data. Only its last four characters are displayed. An environment-only `DEEPSEEK_API_KEY` is supported as a deployment fallback and is never sent to the browser.

The provider retries only retryable failures before visible output, honors timeouts, normalizes streaming events, records sanitized usage/latency, and never forwards raw upstream errors.

## Memory

- Short term: bounded recent messages from the current conversation.
- Summary: schema and prompt support for a rolling summary cursor.
- Long term: only explicit `remember ...` requests are saved by the built-in deterministic extractor. Sensitive categories and seed-phrase-like text are rejected.

Users can disable retrieval, view/delete one memory, clear all memories, export data, or clear all stored data. `forget ...` requests remove matching memories. A queue/scheduled job is recommended before enabling implicit AI-based extraction or automatic summaries at scale.

## Clank.trade knowledge sync

`/admin/knowledge` starts a bounded, public-only crawl from `https://clank.trade/`.

The crawler:

- obeys `robots.txt`;
- accepts HTTPS and exact allowlisted hosts only;
- rejects credentials, IP literals, nonstandard ports, private/auth-like paths, external redirects, and non-text content;
- limits redirects, depth, pages, and page bytes;
- strips scripts, navigation, forms, and repeated boilerplate;
- stores canonical source URL, title, clean text, fetch time, and SHA-256 content hash;
- rechunks only changed pages;
- uses PostgreSQL full-text/trigram search even when no embedding provider exists.

Retrieved records are JSON-encoded inside an explicit untrusted-data prompt boundary. The model cannot choose displayed source URLs; source attribution is built from the server's retrieved database rows. For larger sites, move sync execution to a Supabase Edge Function, Workflow, or queue rather than increasing request duration.

## Testing and verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

The test suite covers AES-GCM encryption/tamper detection, signed-session forgery, DeepSeek model discovery and split-frame streaming, error redaction, explicit memory/forget/sensitivity policy, crawler URL restrictions, HTML stripping, chunking, RAG prompt-injection boundaries, and Bond bounds.

Database integration tests require a disposable Supabase project and should exercise the migrations as two distinct users plus a service client. A credential-gated live DeepSeek smoke test should list models and complete one minimal stream; it is intentionally not part of ordinary CI.

## Production deployment

1. Apply migrations to the production Supabase project.
2. Configure all server-only variables as deployment secrets, not public variables.
3. Add the supplied Cabi artwork.
4. Run `npm run check` and `npm run build`.
5. Deploy the generated Worker archive.
6. Sign in at `/admin/ai`, save/test DeepSeek, and run the first knowledge sync.

Never commit `.env.local`, a DeepSeek key, a Supabase service-role key, or an admin password. Do not configure a `$CPU` contract or trade URL until it has been independently verified; the UI hides unconfigured values rather than inventing them.

## Security notes

- Conversation privacy depends on deployment access, signed sessions, explicit ownership predicates, Supabase RLS, and secure secret handling; the UI does not claim end-to-end encryption.
- Markdown is parsed without raw HTML and passed through `rehype-sanitize`.
- CSP, nosniff, referrer, permissions, COOP, and resource-policy headers are configured in `next.config.ts`.
- Cost-bearing endpoints have rate limits. Production should monitor the PostgreSQL bucket table and add a platform-level Cloudflare limit for defense in depth.
- Audit metadata is redacted and append-only; prompts, message bodies, raw IPs, cookies, API keys, and ciphertext are not stored in audit rows.
- Clank.trade information is informational, not guaranteed financial advice. Cabi never requests wallet secrets or performs custodial trading.
