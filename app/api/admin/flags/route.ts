import { auditAdmin } from "@/lib/admin/audit";
import { adminOrResponse } from "@/lib/admin/auth";
import { defaultFeatureFlags, featureFlagKeys, parseFeatureFlags } from "@/lib/config/feature-flags";
import { readFeatureFlags, writeFeatureFlags } from "@/lib/config/feature-flags.server";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { guardAppApi } from "@/lib/site/guard";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * Feature flags.
 *
 * Resolved and mutated server-side only. The browser can read the effective
 * values (through the page it is served) but cannot set them, and there is no
 * endpoint that accepts a flag from a client context.
 */
export async function GET() {
  const blocked = await guardAppApi();
  if (blocked) return blocked;
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;
  return Response.json(
    { flags: await readFeatureFlags(), defaults: defaultFeatureFlags },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

const schema = z.object({
  flags: z.record(z.string(), z.boolean()),
});

export async function POST(request: Request) {
  const blocked = await guardAppApi();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid request.", 400, "INVALID_INPUT");

  // Unknown keys are dropped rather than stored, so a typo cannot persist a flag
  // that nothing reads.
  const unknown = Object.keys(parsed.data.flags).filter((key) => !featureFlagKeys.includes(key as never));
  if (unknown.length > 0) return jsonError(`Unknown feature flag: ${unknown[0]}`, 400, "UNKNOWN_FLAG");

  const flags = parseFeatureFlags(parsed.data.flags);
  try {
    await writeFeatureFlags(flags, auth.session!.email);
  } catch {
    return jsonError("Those settings could not be saved.", 503, "SAVE_FAILED");
  }

  await auditAdmin(request, auth.session!.email, "feature_flags.save", "app_settings", "feature_flags", "success", { flags });
  return Response.json({ ok: true, flags }, { headers: { "Cache-Control": "private, no-store" } });
}