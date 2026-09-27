import { z } from "zod";

import { featureGate } from "@/lib/config/feature-gate";
import { getServiceClient } from "@/lib/db/supabase";
import { generationBucket, signedImageUrl } from "@/lib/image-generation/storage";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { guardAppApiCpu } from "@/lib/site/guard";
import { walletAuthOrResponse } from "@/lib/wallet/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const locked = await featureGate("contest_enabled");
  if (locked) return locked;
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;
  const db = getServiceClient();
  if (!db) return jsonError("Image contests are not available right now.", 503, "DATABASE_NOT_CONFIGURED");

  const [{ data: contestRows, error: contestError }, { data: ownRows, error: ownError }] = await Promise.all([
    db.from("cabi_image_contests").select("id,title,description,starts_at,ends_at,status,winner_entry_id,created_at,finalized_at").order("created_at", { ascending: false }).limit(12),
    db.from("image_generations").select("id,user_prompt,aspect_ratio,image_path,created_at").eq("wallet_account_id", auth.identity.walletAccountId).eq("status", "COMPLETED").not("image_path", "is", null).order("created_at", { ascending: false }).limit(50),
  ]);
  if (contestError || ownError) return jsonError("Image contests are not available right now.", 503, "CONTESTS_UNAVAILABLE");

  const contests = (contestRows ?? []) as Array<Record<string, unknown>>;
  const contestIds = contests.map((contest) => String(contest.id));
  const { data: entryRows, error: entriesError } = contestIds.length
    ? await db.from("cabi_image_contest_entries")
      .select("id,contest_id,wallet_account_id,image_path,username_snapshot,display_name_snapshot,submitted_at")
      .in("contest_id", contestIds)
      .order("submitted_at", { ascending: false })
      .limit(500)
    : { data: [], error: null };
  if (entriesError) return jsonError("Image contests are not available right now.", 503, "CONTESTS_UNAVAILABLE");

  const entries = await Promise.all(((entryRows ?? []) as Array<Record<string, unknown>>).map(async (row) => ({
    id: String(row.id),
    contestId: String(row.contest_id),
    username: String(row.display_name_snapshot || row.username_snapshot || "Cabi member"),
    submittedAt: String(row.submitted_at),
    imageUrl: await signedImageUrl(generationBucket, String(row.image_path)),
  })));
  const ownEntryByContest = new Map<string, string>();
  for (const row of (entryRows ?? []) as Array<Record<string, unknown>>) {
    if (String(row.wallet_account_id) === auth.identity.walletAccountId) ownEntryByContest.set(String(row.contest_id), String(row.id));
  }
  const now = Date.now();
  const publicContests = contests.map((row) => {
    const startsAt = String(row.starts_at);
    const endsAt = String(row.ends_at);
    const status = String(row.status);
    const starts = new Date(startsAt).getTime();
    const ends = new Date(endsAt).getTime();
    const isOpen = status === "OPEN" && now >= starts && now < ends;
    const contestEntries = entries.filter((entry) => entry.contestId === String(row.id) && entry.imageUrl);
    return {
      id: String(row.id),
      title: String(row.title),
      description: String(row.description ?? ""),
      startsAt,
      endsAt,
      status: status === "OPEN" && now >= ends ? "CLOSED" : status,
      canSubmit: isOpen && !ownEntryByContest.has(String(row.id)),
      ownEntryId: ownEntryByContest.get(String(row.id)) ?? null,
      winnerEntryId: (row.winner_entry_id as string | null) ?? null,
      entries: contestEntries,
    };
  });
  const myImages = await Promise.all(((ownRows ?? []) as Array<Record<string, unknown>>).map(async (row) => ({
    id: String(row.id),
    prompt: String(row.user_prompt),
    aspectRatio: String(row.aspect_ratio),
    createdAt: String(row.created_at),
    url: await signedImageUrl(generationBucket, String(row.image_path)),
  })));

  return Response.json(
    { contests: publicContests, myImages: myImages.filter((image) => image.url) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

const submissionSchema = z.object({ contestId: z.string().uuid(), imageGenerationId: z.string().uuid() });

/** A single entry may be submitted from the user's own completed generations. */
export async function POST(request: Request) {
  const locked = await featureGate("contest_enabled");
  if (locked) return locked;
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const auth = await walletAuthOrResponse();
  if (!auth.identity) return auth.response;
  const parsed = submissionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Choose one of your completed Cabi images.", 400, "INVALID_INPUT");
  const db = getServiceClient();
  if (!db) return jsonError("Image contests are not available right now.", 503, "DATABASE_NOT_CONFIGURED");

  const [{ data: contest }, { data: image }, { data: profile }] = await Promise.all([
    db.from("cabi_image_contests").select("id,status,starts_at,ends_at").eq("id", parsed.data.contestId).maybeSingle(),
    db.from("image_generations").select("id,image_path").eq("id", parsed.data.imageGenerationId).eq("wallet_account_id", auth.identity.walletAccountId).eq("status", "COMPLETED").not("image_path", "is", null).maybeSingle(),
    db.from("profiles").select("username,display_name").eq("wallet_account_id", auth.identity.walletAccountId).maybeSingle(),
  ]);
  if (!contest) return jsonError("That contest could not be found.", 404, "CONTEST_NOT_FOUND");
  const now = Date.now();
  if (contest.status !== "OPEN" || now < new Date(contest.starts_at as string).getTime() || now >= new Date(contest.ends_at as string).getTime()) {
    return jsonError("This contest is not accepting entries now.", 409, "CONTEST_CLOSED");
  }
  if (!image?.image_path) return jsonError("That image is not one of your saved Cabi generations.", 404, "IMAGE_NOT_FOUND");

  const { data: entry, error } = await db.from("cabi_image_contest_entries").insert({
    contest_id: parsed.data.contestId,
    wallet_account_id: auth.identity.walletAccountId,
    image_generation_id: parsed.data.imageGenerationId,
    image_path: image.image_path,
    username_snapshot: (profile?.username as string | null) ?? null,
    display_name_snapshot: (profile?.display_name as string | null) ?? null,
  }).select("id").maybeSingle();
  if (error?.code === "23505") return jsonError("You already submitted an image to this contest.", 409, "ALREADY_SUBMITTED");
  if (error || !entry) return jsonError("I couldn't submit that image right now.", 503, "SUBMISSION_FAILED");
  return Response.json({ ok: true, entryId: String(entry.id) }, { headers: { "Cache-Control": "private, no-store" } });
}
