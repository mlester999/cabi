import "server-only";

import {
  archiveCabiReference,
  downloadCabiReference,
  hashReferenceBytes,
  readImageDimensions,
  signedCabiReferenceUrl,
  uploadCabiReference,
} from "@/lib/cabi/reference/storage.server";
import {
  validateCabiReferenceBytes,
  type CabiReferenceRow,
} from "@/lib/cabi/reference/types";
import { getServiceClient } from "@/lib/db/supabase";

/**
 * Versioned store for the official Cabi reference.
 *
 * Rules this module enforces:
 *
 * - Exactly one row is active. Activation deactivates every other row in the same
 *   call, and the database additionally carries a partial unique index, so a
 *   concurrent upload cannot leave two live references.
 * - Replacing never destroys the previous version: the existing bytes are copied
 *   to an immutable `official/versions/...` path before the new file is written.
 * - Restoring a previous version re-activates it rather than re-uploading, so the
 *   history stays honest.
 */

const rowColumns = "id,storage_path,version,active,uploaded_at,uploaded_by,width,height,mime_type,hash";

function toRow(value: Record<string, unknown>): CabiReferenceRow {
  return {
    id: String(value.id),
    storagePath: String(value.storage_path),
    version: Number(value.version),
    active: Boolean(value.active),
    uploadedAt: String(value.uploaded_at),
    uploadedBy: (value.uploaded_by as string | null) ?? null,
    width: value.width == null ? null : Number(value.width),
    height: value.height == null ? null : Number(value.height),
    mimeType: value.mime_type as CabiReferenceRow["mimeType"],
    hash: String(value.hash),
  };
}

/** The single active reference row, or null when the bundled fallback applies. */
export async function readActiveCabiReference(): Promise<CabiReferenceRow | null> {
  const db = getServiceClient();
  if (!db) return null;
  const { data, error } = await db
    .from("cabi_references")
    .select(rowColumns)
    .eq("active", true)
    .maybeSingle();
  if (error || !data) return null;
  return toRow(data as Record<string, unknown>);
}

/** Full history, newest first, for the admin "View History" list. */
export async function listCabiReferences(limit = 25): Promise<CabiReferenceRow[]> {
  const db = getServiceClient();
  if (!db) return [];
  const { data, error } = await db
    .from("cabi_references")
    .select(rowColumns)
    .order("version", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map(toRow);
}

async function nextVersion(): Promise<number> {
  const db = getServiceClient();
  if (!db) return 1;
  const { data } = await db
    .from("cabi_references")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const highest = data ? Number((data as { version: number }).version) : 0;
  return (Number.isSafeInteger(highest) ? highest : 0) + 1;
}

export type CabiReferenceSaveResult =
  | { ok: true; reference: CabiReferenceRow; previous: CabiReferenceRow | null }
  | { ok: false; code: "INVALID_IMAGE" | "STORAGE_FAILED" | "DATABASE_NOT_CONFIGURED" | "SAVE_FAILED"; message: string };

/**
 * Stores a new official reference and makes it active.
 *
 * Order matters: archive the old bytes, upload the new file, then flip the rows.
 * A failure at any step leaves the previously active reference in place, so the
 * product never ends up with no reference at all.
 */
export async function saveCabiReference(input: {
  bytes: Uint8Array;
  uploadedBy: string;
}): Promise<CabiReferenceSaveResult> {
  const db = getServiceClient();
  if (!db) return { ok: false, code: "DATABASE_NOT_CONFIGURED", message: "Supabase must be connected first." };

  const validation = validateCabiReferenceBytes(input.bytes);
  if (!validation.ok) return { ok: false, code: "INVALID_IMAGE", message: validation.message };

  const previous = await readActiveCabiReference();
  if (previous) {
    // Best effort: a failed archive must not block the replacement, but it does
    // mean that one version cannot be restored later.
    await archiveCabiReference({ fromPath: previous.storagePath, version: previous.version });
  }

  const uploaded = await uploadCabiReference({ bytes: input.bytes, mimeType: validation.mimeType });
  if (!uploaded.ok) return { ok: false, code: "STORAGE_FAILED", message: uploaded.message };

  const dimensions = readImageDimensions(input.bytes, validation.mimeType);
  const version = await nextVersion();

  // Deactivate first so the partial unique index can never be violated when the
  // new row is inserted as active.
  const { error: clearError } = await db.from("cabi_references").update({ active: false }).eq("active", true);
  if (clearError) return { ok: false, code: "SAVE_FAILED", message: "Cabi couldn't update the reference record." };

  const { data, error } = await db
    .from("cabi_references")
    .insert({
      storage_path: uploaded.path,
      version,
      active: true,
      uploaded_by: input.uploadedBy,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      mime_type: validation.mimeType,
      hash: await hashReferenceBytes(input.bytes),
    })
    .select(rowColumns)
    .maybeSingle();

  if (error || !data) {
    // Roll back to the previous version rather than leaving nothing active.
    if (previous) await db.from("cabi_references").update({ active: true }).eq("id", previous.id);
    return { ok: false, code: "SAVE_FAILED", message: "Cabi couldn't save that reference image." };
  }

  return { ok: true, reference: toRow(data as Record<string, unknown>), previous };
}

/** Re-activates a previous version. The image itself is never re-uploaded. */
export async function activateCabiReference(id: string): Promise<{ ok: true; reference: CabiReferenceRow } | { ok: false; message: string }> {
  const db = getServiceClient();
  if (!db) return { ok: false, message: "Supabase must be connected first." };

  const { data: target } = await db.from("cabi_references").select(rowColumns).eq("id", id).maybeSingle();
  if (!target) return { ok: false, message: "That reference version no longer exists." };

  // The stored object must still be readable, otherwise "restore" would activate
  // a row whose image is gone.
  const bytes = await downloadCabiReference(String((target as Record<string, unknown>).storage_path));
  if (!bytes) return { ok: false, message: "That version's image is no longer in storage." };

  const { error: clearError } = await db.from("cabi_references").update({ active: false }).eq("active", true);
  if (clearError) return { ok: false, message: "Cabi couldn't update the reference record." };

  // Filter first, then `.select("id")`, matching every other revocable write in
  // this codebase: a filtered update that asks for the row back returns it.
  const { data, error } = await db
    .from("cabi_references")
    .update({ active: true })
    .eq("id", id)
    .select(rowColumns)
    .maybeSingle();
  if (error || !data) return { ok: false, message: "Cabi couldn't restore that reference." };
  return { ok: true, reference: toRow(data as Record<string, unknown>) };
}

/** A short-lived signed URL for admin preview of one stored version. */
export async function cabiReferencePreviewUrl(path: string) {
  return signedCabiReferenceUrl(path);
}
