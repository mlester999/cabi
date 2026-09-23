import { adminOrResponse } from "@/lib/admin/auth";
import { auditAdmin } from "@/lib/admin/audit";
import { getServiceClient } from "@/lib/db/supabase";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import {
  defaultSiteMode,
  environmentSiteMode,
  getSiteModeUncached,
  readDatabaseSiteMode,
  siteModes,
  writeDatabaseSiteMode,
  type SiteMode,
} from "@/lib/site/mode";
import { z } from "zod";

const bodySchema = z.object({ mode: z.enum(siteModes as unknown as [SiteMode, ...SiteMode[]]) });

/**
 * Website mode control.
 *
 * GET reports the effective mode, where it came from, and whether the
 * environment is currently overriding it, so the dashboard can explain why a
 * saved change may not be visible.
 */
export async function GET() {
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;
  const resolved = await getSiteModeUncached();
  const stored = await readDatabaseSiteMode();
  return Response.json(
    {
      mode: resolved.mode,
      source: resolved.source,
      override: resolved.override,
      stored,
      environmentMode: environmentSiteMode(),
      defaultMode: defaultSiteMode,
      databaseReady: Boolean(getServiceClient()),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * Changes the public site mode and records an audit event.
 *
 * Switching PRELAUNCH -> LIVE takes effect immediately, with no redeploy,
 * because the value is read from the database on every request (memoized only
 * for a few seconds). An environment override, when set, always wins and the
 * response says so.
 */
export async function PATCH(request: Request) {
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Choose PRELAUNCH, LIVE, or MAINTENANCE.", 400, "INVALID_INPUT");

  const db = getServiceClient();
  if (!db) return jsonError("Supabase must be connected before the website mode can be saved.", 503, "DATABASE_NOT_CONFIGURED");

  const previous = await getSiteModeUncached();
  try {
    await writeDatabaseSiteMode(parsed.data.mode, auth.session!.email);
  } catch {
    return jsonError("Couldn't save the website mode.", 503, "SAVE_FAILED");
  }

  await auditAdmin(request, auth.session!.email, parsed.data.mode === "LIVE" ? "site.launch" : "site.mode.update", "site_mode", parsed.data.mode, "success", {
    from: previous.mode,
    to: parsed.data.mode,
    environmentOverride: Boolean(environmentSiteMode()),
  });

  const resolved = await getSiteModeUncached();
  return Response.json(
    { ok: true, mode: resolved.mode, source: resolved.source, override: resolved.override },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
