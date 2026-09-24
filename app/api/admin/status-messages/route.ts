import { auditAdmin } from "@/lib/admin/audit";
import { adminOrResponse } from "@/lib/admin/auth";
import {
  cabiStatusDefaultLines,
  cabiStatusMessagesKey,
  cabiStatusMessagesSchema,
  cabiStatusMaxPerCategory,
  parseCabiStatusMessages,
  readCabiStatusMessages,
  resetCabiStatusMessages,
  writeCabiStatusMessages,
} from "@/lib/cabi/status-settings.server";
import { cabiStatusTypes } from "@/lib/cabi/status-messages";
import { assertSameOrigin, jsonError } from "@/lib/security/request";

export const dynamic = "force-dynamic";

/**
 * Owner-added Cabi activity messages.
 *
 * The built-in lines are shipped in code and cannot be edited or deleted here;
 * this endpoint only manages the owner's *extra* lines, per category. The admin
 * session is the authorization, so it works in every site mode — personality copy
 * is configuration, not an unfinished public surface.
 */
export async function GET() {
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;
  const settings = await readCabiStatusMessages({ fresh: true });
  return Response.json(
    {
      settings,
      defaults: cabiStatusDefaultLines(),
      categories: cabiStatusTypes,
      maxPerCategory: cabiStatusMaxPerCategory,
      settingKey: cabiStatusMessagesKey,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function PATCH(request: Request) {
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const admin = auth.session!;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return jsonError("Invalid request.", 400, "INVALID_INPUT");

  if (body.section === "reset") {
    const settings = await resetCabiStatusMessages();
    await auditAdmin(request, admin.email, "cabi.status_messages_reset", "app_settings", cabiStatusMessagesKey, "success", {});
    return Response.json({ ok: true, settings }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const parsed = cabiStatusMessagesSchema.safeParse(body.messages ?? {});
  if (!parsed.success) {
    return jsonError(`Each line must be between 1 and 120 characters, with at most ${cabiStatusMaxPerCategory} per category.`, 400, "INVALID_INPUT");
  }

  const before = await readCabiStatusMessages({ fresh: true });
  const next = parseCabiStatusMessages({ enabled: parsed.data.enabled ?? before.enabled, custom: parsed.data.custom ?? before.custom });
  let saved;
  try {
    saved = await writeCabiStatusMessages(next, admin.email);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SAVE_FAILED";
    if (code === "DATABASE_NOT_CONFIGURED") return jsonError("Supabase must be connected first.", 503, code);
    return jsonError("Those messages could not be saved.", 503, "SAVE_FAILED");
  }

  await auditAdmin(request, admin.email, "cabi.status_messages_update", "app_settings", cabiStatusMessagesKey, "success", {
    enabledChanged: before.enabled !== saved.enabled ? { from: before.enabled, to: saved.enabled } : undefined,
    // Counts only: the message text itself is product copy, not an audit concern.
    categoryCounts: Object.fromEntries(Object.entries(saved.custom).map(([type, lines]) => [type, lines?.length ?? 0])),
  });

  return Response.json({ ok: true, settings: saved }, { headers: { "Cache-Control": "private, no-store" } });
}
