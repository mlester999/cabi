# Cabi image-generation diagnostic

## Finding

The first hypothesis was that chat failed because of a reference input that
Together could not fetch. Vercel's full-generation test then supplied the
decisive evidence: Qwen/Qwen-Image-2.0 rejects the `steps` parameter with HTTP
400 (`Unsupported use of 'steps' parameter. This parameter is not supported for
the selected model.`). The shared request builder now omits `steps` for that
model. Reference-input validation below remains a separate safeguard.

The chat failure also returned the provider message as prose and rendered a
notice card, which created duplicate failure UI. An empty image reply could then
fall through to the normal chat model. Both behaviors are now removed.

## Canonical request comparison

Both paths now call `resolveImageGenerationConfig()` in
`lib/image-generation/settings.ts`. It returns the live saved provider, model,
canonical Together endpoint, decrypted key source, model capabilities, aspect
ratio, quality, and quota limits without a cache window.

The admin probe request is:

```json
{
  "model": "<selected canonical model>",
  "prompt": "Cabi connection test",
  "width": 512,
  "height": 512,
  "n": 1,
  "response_format": "url"
}
```

The chat request uses the same endpoint, model, bearer credential and response
format, with the server-built Cabi prompt and the selected model's supported
fields:

```json
{
  "model": "<saved canonical model>",
  "prompt": "<server-built Cabi prompt>",
  "n": 1,
  "response_format": "url",
  "width": "<selected ratio width>",
  "height": "<selected ratio height>",
  "steps": 28,
  "seed": "<only when supported and present>",
  "negative_prompt": "<only when supported>",
  "image_url": "<only a fresh HTTPS signed admin-reference URL>"
}
```

`steps` is optional and emitted only when the selected model declares support.
The Vercel error above led the registry to mark `supportsSteps: false` for Qwen
2.0, so the shared builder omits it from chat and admin full-test requests.
Other models keep their registry-declared step behavior. `negative_prompt`
remains enabled for Qwen 2.0; the Vercel evidence implicated `steps`, not that
field. Aspect-ratio dimensions remain unchanged at 1024x1024 for square requests.

`image_url` is omitted for the bundled local fallback and for models that do not
advertise reference support. Data URLs, HTTP URLs, localhost URLs and local paths
are rejected before reaching Together. Generated HTTPS result URLs are fetched
with a non-empty `User-Agent` before private storage upload.

## Failure and persistence behavior

`lib/image-generation/execute.ts` permits one fallback only when a request that
actually included a reference receives HTTP 403. It retries text-only and treats
the reference as the cause only if that retry succeeds. HTTP 401, 402, 429,
timeouts, model errors and 5xx provider outages are returned without fallback.

The stored `reference_conditioned` flag is repaired when the text-only retry is
the request that succeeds. A retry card carries the original user prompt and
`parentGenerationId`; the chat route persists the retry relation and no longer
renders an empty assistant bubble next to the retry card.

## Safe temporary diagnostics

Set `IMAGE_GENERATION_DIAGNOSTICS=1` temporarily and run the admin test followed
by the same chat request. Server logs contain only source (`ADMIN_TEST`,
`CHAT_GENERATION` or `HTTP_GENERATION`), provider, model, endpoint, key-present
and last-four metadata, reference version/input type, dimensions, response
format, request-started, status, and an error category. Prompts, full keys,
signed URLs and provider response bodies are never logged.

The owner-only `/admin/images` full test also displays a separately sanitized,
allowlisted Together error (`code`, `type`, `parameter`, and a redacted, capped
message), plus the minimal connection request next to the full request's safe
field/shape summary. This detail is returned only by the admin test endpoint
and is retained in the trace only for `ADMIN_TEST`; normal chat results and
chat traces do not expose it. A generic HTTP 400 is not treated as an unsafe
prompt, and no request field should be removed based on the status alone. The
confirmed Vercel response above is the evidence for omitting `steps` only for
Qwen 2.0.

## Verification

- `npm run lint` — passed
- `npm run typecheck` — passed
- `npm test -- --run` — 64 files passed; 844 tests passed, 2 skipped
- `npm run build` — passed

No local `.env`/`.env.local` Together credential was present for an additional
paid live generation from this checkout. The existing admin test remains the
safe live probe and now exercises the same canonical resolver as chat.
