import { auditAdmin } from "@/lib/admin/audit";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { readAdminSession } from "@/lib/security/session";
import { clearOwnerPreviewCookie } from "@/lib/site/owner-preview";
import { clearPreviewCookie, isPreviewActive } from "@/lib/site/preview";

export async function DELETE(request: Request) {
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const admin = await readAdminSession().catch(() => null);
  const hadAdminPreview = admin ? await isPreviewActive().catch(() => false) : false;
  const response = Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  response.headers.append("Set-Cookie", clearOwnerPreviewCookie());
  response.headers.append("Set-Cookie", clearPreviewCookie());
  if (hadAdminPreview && admin) {
    await auditAdmin(request, admin.email, "site.preview.stop", "site_mode", "preview", "success").catch(() => {});
  }
  return response;
}
