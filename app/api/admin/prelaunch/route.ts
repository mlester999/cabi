import { adminOrResponse } from "@/lib/admin/auth";
import { auditAdmin } from "@/lib/admin/audit";
import { getServiceClient } from "@/lib/db/supabase";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { defaultPrelaunchSettings } from "@/lib/site/prelaunch-shared";
import { parsePrelaunchSettings, prelaunchSettingKey, prelaunchSettingsSchema } from "@/lib/site/prelaunch";

/**
 * Owner-editable prelaunch copy.
 *
 * A dedicated route (rather than the generic `/api/admin/config/[key]`) so the
 * payload is validated by the same Zod schema the public page parses with, and
 * so the response always returns the fully normalised settings that will be
 * rendered.
 */
export async function GET() {
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;
  const db = getServiceClient();
  if (!db) return Response.json({ value: defaultPrelaunchSettings, databaseReady: false }, { headers: { "Cache-Control": "private, no-store" } });
  const { data } = await db.from("app_settings").select("value_json").eq("key", prelaunchSettingKey).maybeSingle();
  return Response.json(
    { value: data?.value_json ? parsePrelaunchSettings(data.value_json) : defaultPrelaunchSettings, databaseReady: true },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function PATCH(request: Request) {
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }

  const parsed = prelaunchSettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid prelaunch settings.", code: "INVALID_INPUT", details: parsed.error.issues.map((issue) => issue.message) },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const db = getServiceClient();
  if (!db) return jsonError("Supabase must be connected first.", 503, "DATABASE_NOT_CONFIGURED");
  const value = parsed.data;
  const { error } = await db
    .from("app_settings")
    .upsert({ key: prelaunchSettingKey, value_json: value, updated_by: auth.session!.email }, { onConflict: "key" });
  if (error) return jsonError("Couldn't save the prelaunch page.", 503, "SAVE_FAILED");

  await auditAdmin(request, auth.session!.email, "site.prelaunch.update", "app_settings", prelaunchSettingKey, "success", {
    fields: Object.keys(value),
    cpuStatus: value.cpuStatus,
    showCpu: value.showCpu,
    showSocial: value.showSocial,
  });
  return Response.json({ value: parsePrelaunchSettings(value) }, { headers: { "Cache-Control": "private, no-store" } });
}
