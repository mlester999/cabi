import { cookies } from "next/headers";

import { adminOrResponse } from "@/lib/admin/auth";
import { auditAdmin } from "@/lib/admin/audit";
import { jsonError } from "@/lib/security/request";
import { createPreviewToken, previewCookieName, previewCookieOptions, previewTtlSeconds } from "@/lib/site/preview";

/**
 * Starts or ends the admin live preview.
 *
 * The preview is what unlocks the unfinished application while the public site
 * is in PRELAUNCH or MAINTENANCE. Both verbs are admin-only and server-side;
 * the cookie is signed, HttpOnly, and short-lived.
 */
export async function POST(request: Request) {
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;
  const email = auth.session!.email;
  const token = await createPreviewToken(email);
  const jar = await cookies();
  jar.set(previewCookieName, token, { ...previewCookieOptions, maxAge: previewTtlSeconds });
  await auditAdmin(request, email, "site.preview.start", "site_mode", "preview", "success", { ttlSeconds: previewTtlSeconds });
  return Response.json({ ok: true, expiresInSeconds: previewTtlSeconds }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(request: Request) {
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;
  const jar = await cookies();
  jar.set(previewCookieName, "", { ...previewCookieOptions, maxAge: 0 });
  await auditAdmin(request, auth.session!.email, "site.preview.stop", "site_mode", "preview", "success");
  return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function GET() {
  return jsonError("Use POST to start preview or DELETE to end it.", 405, "METHOD_NOT_ALLOWED");
}
