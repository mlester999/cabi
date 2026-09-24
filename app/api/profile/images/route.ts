import { listGenerations, readQuota } from "@/lib/image-generation/lifecycle";
import { deleteGeneration } from "@/lib/image-generation/lifecycle";
import { readImageSettings } from "@/lib/image-generation/settings";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { guardAppApi } from "@/lib/site/guard";
import { walletAuthOrResponse } from "@/lib/wallet/session";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * My Cabi Images.
 *
 * The small authenticated list behind Profile, not a public gallery: every read
 * and every delete is scoped to the session wallet, so there is no id a caller
 * could pass to reach another wallet's images.
 *
 * URLs are signed per request and never stored, so a copied link stops working
 * rather than exposing someone's images later.
 */
export async function GET() {
  const blocked = await guardAppApi();
  if (blocked) return blocked;
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;

  const settings = await readImageSettings();
  const [images, quota] = await Promise.all([
    listGenerations(auth.identity.walletAccountId),
    readQuota(auth.identity.walletAccountId, settings.dailyLimit),
  ]);

  return Response.json(
    { images, quota },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

const deleteSchema = z.object({ id: z.string().uuid() });

/** Deletes one image. Ownership is verified as part of the operation. */
export async function DELETE(request: Request) {
  const blocked = await guardAppApi();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid request.", 400, "INVALID_INPUT");

  const result = await deleteGeneration(auth.identity.walletAccountId, parsed.data.id);
  if (!result.ok) {
    return result.reason === "NOT_FOUND"
      ? jsonError("That image doesn't exist.", 404, "NOT_FOUND")
      : jsonError("I couldn't remove that image.", 503, "STORAGE_FAILED");
  }
  return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}