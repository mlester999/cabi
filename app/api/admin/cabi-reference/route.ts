import { auditAdmin } from "@/lib/admin/audit";
import { adminOrResponse } from "@/lib/admin/auth";
import {
  cabiCharacterBibleDefaults,
  cabiCharacterBibleSchema,
  readCabiCharacterBible,
  resetCabiCharacterBible,
  writeCabiCharacterBible,
} from "@/lib/cabi/character-bible.server";
import { cabiProhibitedDrift } from "@/lib/cabi/image-identity";
import { cabiReferencePreviewUrl, activateCabiReference, listCabiReferences, saveCabiReference } from "@/lib/cabi/reference/store.server";
import { resolveCabiReference } from "@/lib/cabi/reference/resolve.server";
import { cabiReferenceMaxBytes, type CabiReferenceRow } from "@/lib/cabi/reference/types";
import { imageCapabilitiesFor } from "@/lib/image-generation/provider";
import { readImageSettings } from "@/lib/image-generation/settings";
import { assertSameOrigin, jsonError } from "@/lib/security/request";

export const dynamic = "force-dynamic";

/**
 * Admin control for Cabi's official character reference.
 *
 * Every route here is admin-only and audited. The reference is a SYSTEM asset —
 * replacing it changes what Cabi looks like in every future generation — so:
 *
 * - a non-admin cannot upload (checked before anything is read from the body),
 * - an invalid image is rejected on its magic bytes, never on a declared type,
 * - replacing archives the previous version rather than destroying it,
 * - and exactly one version is active, enforced by the database as well.
 *
 * A user-facing surface for this does not exist anywhere in the product: the
 * reference is never supplied by, or editable from, a browser session.
 *
 * This is NOT gated by the site mode, deliberately and consistently with the other
 * admin configuration routes (`/api/admin/cpu`, `/api/admin/images`): the owner
 * must be able to manage Cabi's identity asset during PRELAUNCH and MAINTENANCE,
 * and unlike a public API there is no unfinished public surface here to withhold.
 * The authorization is the admin session itself, checked before anything else and
 * before a single byte of an upload is read.
 */
export async function GET() {
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;

  const [resolved, history, settings, bible] = await Promise.all([
    resolveCabiReference(),
    listCabiReferences(),
    readImageSettings(),
    readCabiCharacterBible({ fresh: true }),
  ]);

  const isUpload = "source" in resolved && resolved.source === "ADMIN_UPLOAD";
  const activeRow = history.find((row) => row.active) ?? null;
  const activePath = isUpload ? resolved.path : activeRow?.storagePath ?? null;
  const preview = activePath ? await cabiReferencePreviewUrl(activePath).catch(() => null) : null;
  const capabilities = imageCapabilitiesFor({ provider: settings.provider, model: settings.model });

  const historyWithUrls = await Promise.all(history.map(async (row: CabiReferenceRow) => ({
    ...row,
    previewUrl: row.active ? preview : await cabiReferencePreviewUrl(row.storagePath).catch(() => null),
  })));

  return Response.json(
    {
      reference: {
        source: "source" in resolved ? resolved.source : "BUNDLED",
        version: "source" in resolved ? resolved.version : 0,
        path: activePath,
        mimeType: activeRow?.mimeType ?? "image/png",
        width: "source" in resolved ? resolved.width : 500,
        height: "source" in resolved ? resolved.height : 500,
        uploadedAt: activeRow?.uploadedAt ?? null,
        uploadedBy: activeRow?.uploadedBy ?? null,
        hash: activeRow?.hash ?? null,
        previewUrl: preview,
        /** The shipped asset used when no admin upload is active. */
        fallbackPath: "/assets/cabi-cpu-model.png",
      },
      history: historyWithUrls,
      provider: {
        provider: settings.provider,
        model: settings.model,
        referenceConfigured: Boolean(activeRow) || Boolean(activePath),
        capabilities,
        /** Never claims conditioning the model cannot do. */
        message: capabilities.supportsReferenceImages
          ? "The active model accepts Cabi's official reference automatically with every generation."
          : "The current model uses Cabi's character specification, but cannot directly condition on the uploaded reference image.",
      },
      bible: {
        artDirection: bible.artDirection,
        negative: bible.negative,
        customized: bible.customized,
        defaults: cabiCharacterBibleDefaults,
        protectedTraits: cabiProhibitedDrift,
      },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * Uploads a new official reference.
 *
 * The image arrives as raw bytes rather than multipart: one file, one field, and
 * the format is decided by sniffing the magic bytes server-side rather than by
 * trusting a `Content-Type` a client chose.
 */
export async function POST(request: Request) {
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;
  const admin = auth.session!;

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > cabiReferenceMaxBytes + 4_096) {
    return jsonError("That image is too large. Keep it under 8 MB.", 413, "IMAGE_TOO_LARGE");
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await request.arrayBuffer());
  } catch {
    return jsonError("That upload could not be read.", 400, "INVALID_UPLOAD");
  }
  if (bytes.byteLength === 0) return jsonError("That file was empty.", 400, "INVALID_UPLOAD");

  const saved = await saveCabiReference({ bytes, uploadedBy: admin.email });
  if (!saved.ok) {
    const status = saved.code === "INVALID_IMAGE" ? 400 : saved.code === "DATABASE_NOT_CONFIGURED" ? 503 : 502;
    await auditAdmin(request, admin.email, "cabi.reference_upload", "cabi_references", null, "failure", {
      code: saved.code,
      bytes: bytes.byteLength,
    });
    return jsonError(saved.message, status, saved.code);
  }

  await auditAdmin(request, admin.email, "cabi.reference_upload", "cabi_references", saved.reference.id, "success", {
    version: saved.reference.version,
    previousVersion: saved.previous?.version ?? null,
    mimeType: saved.reference.mimeType,
    width: saved.reference.width,
    height: saved.reference.height,
    hash: saved.reference.hash,
  });

  return Response.json(
    { ok: true, reference: saved.reference, previousVersion: saved.previous?.version ?? null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * Restores a previous version, or edits the character bible.
 *
 * Restoring re-activates an existing row; it never re-uploads, and it refuses if
 * that version's object is no longer in storage, so an active reference always
 * has an image behind it.
 */
export async function PATCH(request: Request) {
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;
  const admin = auth.session!;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return jsonError("Invalid request.", 400, "INVALID_INPUT");

  if (body.section === "bible") {
    const parsed = cabiCharacterBibleSchema.safeParse(body.bible ?? {});
    if (!parsed.success) return jsonError("Those character notes are too long.", 400, "INVALID_INPUT");
    try {
      const saved = await writeCabiCharacterBible(parsed.data, admin.email);
      await auditAdmin(request, admin.email, "cabi.character_bible_update", "app_settings", "cabi_character_bible", "success", {
        artDirectionLength: saved.artDirection.length,
        negativeLength: saved.negative.length,
        customized: saved.customized,
      });
      return Response.json({ ok: true, bible: saved }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
      const code = error instanceof Error ? error.message : "SAVE_FAILED";
      if (code === "DATABASE_NOT_CONFIGURED") return jsonError("Supabase must be connected first.", 503, code);
      return jsonError("Those character notes could not be saved.", 503, "SAVE_FAILED");
    }
  }

  if (body.section === "bible-reset") {
    const bible = await resetCabiCharacterBible();
    await auditAdmin(request, admin.email, "cabi.character_bible_reset", "app_settings", "cabi_character_bible", "success", {});
    return Response.json({ ok: true, bible }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const id = typeof body.activateId === "string" ? body.activateId : "";
  if (!id) return jsonError("Invalid request.", 400, "INVALID_INPUT");

  const restored = await activateCabiReference(id);
  if (!restored.ok) {
    await auditAdmin(request, admin.email, "cabi.reference_restore", "cabi_references", id, "failure", {});
    return jsonError(restored.message, 400, "RESTORE_FAILED");
  }
  await auditAdmin(request, admin.email, "cabi.reference_restore", "cabi_references", restored.reference.id, "success", {
    version: restored.reference.version,
  });
  return Response.json({ ok: true, reference: restored.reference }, { headers: { "Cache-Control": "private, no-store" } });
}
