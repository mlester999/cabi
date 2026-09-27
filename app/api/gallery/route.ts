import { z } from "zod";

import { getServiceClient } from "@/lib/db/supabase";
import { generationBucket, signedImageUrl } from "@/lib/image-generation/storage";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { featureGate } from "@/lib/config/feature-gate";
import { guardAppApiCpu } from "@/lib/site/guard";
import { walletAuthOrResponse } from "@/lib/wallet/session";
import { deleteGeneration } from "@/lib/image-generation/lifecycle";

export const dynamic = "force-dynamic";

/**
 * The signed-in user's generated Cabi images.
 *
 * Scoped to the session wallet at the query level, so there is no id a caller
 * could pass to read someone else's generation. Images are served through
 * short-lived signed URLs rather than public paths.
 *
 * Only the user's own prompt is returned. The internal character specification
 * is never stored on the row and is never part of a response.
 */
type GalleryFilter = "RECENT" | "FAVORITES" | "CONTEST";

export async function GET(request: Request) {
  // Closed while this feature is unreleased, before anything else runs.
  const locked = await featureGate("gallery_enabled");
  if (locked) return locked;
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;

  const db = getServiceClient();
  if (!db) return jsonError("Image storage isn't configured.", 503, "DATABASE_NOT_CONFIGURED");

  const url = new URL(request.url);
  const requestedFilter = url.searchParams.get("filter")?.toUpperCase();
  const filter: GalleryFilter = requestedFilter === "FAVORITES" ? "FAVORITES" : requestedFilter === "CONTEST" ? "CONTEST" : "RECENT";

  let filteredIds: string[] | null = null;
  if (filter === "FAVORITES") {
    const { data, error } = await db.from("image_generation_favorites")
      .select("image_generation_id")
      .eq("wallet_account_id", auth.identity.walletAccountId)
      .order("created_at", { ascending: false })
      .limit(1_000);
    if (error) return jsonError("Favorites are not available right now.", 503, "FAVORITES_UNAVAILABLE");
    filteredIds = (data ?? []).map((row) => String(row.image_generation_id));
  } else if (filter === "CONTEST") {
    const { data, error } = await db.from("cabi_image_contest_entries")
      .select("image_generation_id")
      .eq("wallet_account_id", auth.identity.walletAccountId)
      .order("submitted_at", { ascending: false })
      .limit(1_000);
    if (error) return jsonError("Contest entries are not available right now.", 503, "CONTEST_ENTRIES_UNAVAILABLE");
    filteredIds = (data ?? []).map((row) => String(row.image_generation_id));
  }

  if (filteredIds?.length === 0) return Response.json({ images: [], filter }, { headers: { "Cache-Control": "private, no-store" } });

  let query = db.from("image_generations")
    .select("id,user_prompt,aspect_ratio,model,image_path,created_at")
    .eq("wallet_account_id", auth.identity.walletAccountId)
    .eq("status", "COMPLETED")
    .not("image_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(60);
  if (filteredIds) query = query.in("id", filteredIds);
  const { data, error } = await query;
  if (error) return jsonError("Images are not available right now.", 503, "GALLERY_UNAVAILABLE");

  const rows = (data ?? []) as Array<{ id: string; user_prompt: string; aspect_ratio: string; model: string | null; image_path: string; created_at: string }>;
  const ids = rows.map((row) => row.id);
  const [{ data: favoriteRows, error: favoritesError }, { data: contestRows, error: contestsError }] = ids.length ? await Promise.all([
    db.from("image_generation_favorites").select("image_generation_id").eq("wallet_account_id", auth.identity.walletAccountId).in("image_generation_id", ids),
    db.from("cabi_image_contest_entries").select("image_generation_id,contest_id").eq("wallet_account_id", auth.identity.walletAccountId).in("image_generation_id", ids),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (favoritesError || contestsError) return jsonError("Image details are not available right now.", 503, "GALLERY_DETAILS_UNAVAILABLE");
  const favorites = new Set((favoriteRows ?? []).map((row) => String(row.image_generation_id)));
  const contestByImage = new Map((contestRows ?? []).map((row) => [String(row.image_generation_id), String(row.contest_id)]));

  const images = await Promise.all(rows.map(async (row) => ({
    id: row.id,
    prompt: row.user_prompt,
    aspectRatio: row.aspect_ratio,
    model: row.model,
    createdAt: row.created_at,
    isFavorite: favorites.has(row.id),
    isContestEntry: contestByImage.has(row.id),
    contestId: contestByImage.get(row.id) ?? null,
    url: await signedImageUrl(generationBucket, row.image_path),
  })));

  return Response.json(
    { images: images.filter((image) => image.url), filter },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

const deleteSchema = z.object({ id: z.string().uuid() });
const favoriteSchema = z.object({ id: z.string().uuid(), favorite: z.boolean() });

/** Adds or removes a favorite only for one of the caller's own completed images. */
export async function PATCH(request: Request) {
  const locked = await featureGate("gallery_enabled");
  if (locked) return locked;
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;
  const parsed = favoriteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Choose one of your saved images.", 400, "INVALID_INPUT");
  const db = getServiceClient();
  if (!db) return jsonError("Image storage isn't configured.", 503, "DATABASE_NOT_CONFIGURED");

  const { data: image, error: imageError } = await db.from("image_generations")
    .select("id")
    .eq("id", parsed.data.id)
    .eq("wallet_account_id", auth.identity.walletAccountId)
    .eq("status", "COMPLETED")
    .maybeSingle();
  if (imageError) return jsonError("I couldn't update that favorite.", 503, "FAVORITE_UPDATE_FAILED");
  if (!image) return jsonError("That image could not be found.", 404, "NOT_FOUND");

  if (parsed.data.favorite) {
    const { error } = await db.from("image_generation_favorites").upsert({
      wallet_account_id: auth.identity.walletAccountId,
      image_generation_id: parsed.data.id,
    }, { onConflict: "wallet_account_id,image_generation_id", ignoreDuplicates: true });
    if (error) return jsonError("I couldn't save that favorite.", 503, "FAVORITE_UPDATE_FAILED");
  } else {
    const { error } = await db.from("image_generation_favorites")
      .delete()
      .eq("wallet_account_id", auth.identity.walletAccountId)
      .eq("image_generation_id", parsed.data.id);
    if (error) return jsonError("I couldn't remove that favorite.", 503, "FAVORITE_UPDATE_FAILED");
  }

  return Response.json({ ok: true, favorite: parsed.data.favorite }, { headers: { "Cache-Control": "private, no-store" } });
}

/**
 * Deletes one of the caller's own generations.
 *
 * The ownership predicate is part of the delete itself, so a request naming
 * another user's id removes nothing rather than removing the wrong row.
 */
export async function DELETE(request: Request) {
  // Closed while this feature is unreleased, before anything else runs.
  const locked = await featureGate("gallery_enabled");
  if (locked) return locked;
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid request.", 400, "INVALID_INPUT");

  const result = await deleteGeneration(auth.identity.walletAccountId, parsed.data.id);
  if (!result.ok) {
    if (result.reason === "NOT_FOUND") return jsonError("That image doesn't exist.", 404, "NOT_FOUND");
    if (result.reason === "IN_CONTEST") return jsonError("An image submitted to a contest cannot be deleted.", 409, "IMAGE_IN_CONTEST");
    return jsonError("I couldn't remove that image.", 503, "STORAGE_FAILED");
  }

  return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
