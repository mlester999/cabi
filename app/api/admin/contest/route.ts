import { z } from "zod";

import { adminOrResponse } from "@/lib/admin/auth";
import { auditAdmin } from "@/lib/admin/audit";
import { getServiceClient } from "@/lib/db/supabase";
import { generationBucket, signedImageUrl } from "@/lib/image-generation/storage";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { guardAppApiCpu } from "@/lib/site/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  const admin = await adminOrResponse();
  if (admin.response) return admin.response;
  const db = getServiceClient();
  if (!db) return jsonError("Contest storage is not configured.", 503, "DATABASE_NOT_CONFIGURED");

  const { data: contests, error } = await db.from("cabi_image_contests")
    .select("id,title,description,starts_at,ends_at,status,winner_entry_id,created_at,finalized_at")
    .order("created_at", { ascending: false }).limit(50);
  if (error) return jsonError("Contest storage is not available.", 503, "CONTESTS_UNAVAILABLE");
  const ids = (contests ?? []).map((contest) => String(contest.id));
  const { data: entries, error: entriesError } = ids.length
    ? await db.from("cabi_image_contest_entries")
      .select("id,contest_id,image_generation_id,image_path,username_snapshot,display_name_snapshot,submitted_at")
      .in("contest_id", ids).order("submitted_at", { ascending: false }).limit(1_000)
    : { data: [], error: null };
  if (entriesError) return jsonError("Contest entries are not available.", 503, "ENTRIES_UNAVAILABLE");

  const rows = await Promise.all(((entries ?? []) as Array<Record<string, unknown>>).map(async (entry) => ({
    id: String(entry.id),
    contestId: String(entry.contest_id),
    imageGenerationId: String(entry.image_generation_id),
    username: String(entry.display_name_snapshot || entry.username_snapshot || "Cabi member"),
    submittedAt: String(entry.submitted_at),
    imageUrl: await signedImageUrl(generationBucket, String(entry.image_path)),
  })));
  return Response.json({ contests, entries: rows.filter((entry) => entry.imageUrl) }, { headers: { "Cache-Control": "private, no-store" } });
}

const createSchema = z.object({
  action: z.literal("create"),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
});
const updateSchema = z.discriminatedUnion("action", [
  createSchema,
  z.object({ action: z.literal("status"), contestId: z.string().uuid(), status: z.enum(["DRAFT", "OPEN", "CLOSED"]) }),
  z.object({ action: z.literal("winner"), contestId: z.string().uuid(), entryId: z.string().uuid() }),
]);

export async function POST(request: Request) {
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const admin = await adminOrResponse();
  if (admin.response) return admin.response;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Check the contest details and try again.", 400, "INVALID_INPUT");
  if (parsed.data.action === "create" && new Date(parsed.data.endsAt).getTime() <= new Date(parsed.data.startsAt).getTime()) {
    return jsonError("Contest end must come after its start.", 400, "INVALID_INPUT");
  }
  const db = getServiceClient();
  if (!db) return jsonError("Contest storage is not configured.", 503, "DATABASE_NOT_CONFIGURED");

  if (parsed.data.action === "create") {
    const { data, error } = await db.from("cabi_image_contests").insert({
      title: parsed.data.title,
      description: parsed.data.description,
      starts_at: parsed.data.startsAt,
      ends_at: parsed.data.endsAt,
      status: "DRAFT",
      created_by: admin.session.email,
    }).select("id").maybeSingle();
    if (error || !data) return jsonError("I couldn't create that contest.", 503, "CONTEST_CREATE_FAILED");
    await auditAdmin(request, admin.session.email, "contest.create", "cabi_image_contest", String(data.id), "success", { title: parsed.data.title, startsAt: parsed.data.startsAt, endsAt: parsed.data.endsAt });
    return Response.json({ ok: true, id: String(data.id) }, { headers: { "Cache-Control": "private, no-store" } });
  }

  if (parsed.data.action === "status") {
    const { data: current } = await db.from("cabi_image_contests").select("status,ends_at").eq("id", parsed.data.contestId).maybeSingle();
    if (!current) return jsonError("That contest could not be found.", 404, "CONTEST_NOT_FOUND");
    if (current.status === "FINALIZED") return jsonError("A finalized contest is kept in history.", 409, "CONTEST_FINALIZED");
    if (parsed.data.status === "OPEN" && new Date(current.ends_at as string).getTime() <= Date.now()) return jsonError("A contest cannot be reopened after its end time.", 409, "CONTEST_ENDED");
    const { error } = await db.from("cabi_image_contests").update({ status: parsed.data.status }).eq("id", parsed.data.contestId);
    if (error) return jsonError("I couldn't update that contest.", 503, "CONTEST_UPDATE_FAILED");
    await auditAdmin(request, admin.session.email, "contest.status", "cabi_image_contest", parsed.data.contestId, "success", { status: parsed.data.status });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const [{ data: contest }, { data: entry }] = await Promise.all([
    db.from("cabi_image_contests").select("id,ends_at,status").eq("id", parsed.data.contestId).maybeSingle(),
    db.from("cabi_image_contest_entries").select("id,contest_id").eq("id", parsed.data.entryId).eq("contest_id", parsed.data.contestId).maybeSingle(),
  ]);
  if (!contest || !entry) return jsonError("Choose an entry from this contest.", 404, "ENTRY_NOT_FOUND");
  if (contest.status === "FINALIZED") return jsonError("This contest is already finalized.", 409, "CONTEST_FINALIZED");
  if (new Date(contest.ends_at as string).getTime() > Date.now()) return jsonError("Wait until the contest closes before selecting a winner.", 409, "CONTEST_STILL_OPEN");
  const { data: finalized, error } = await db.from("cabi_image_contests")
    .update({ status: "FINALIZED", winner_entry_id: parsed.data.entryId, finalized_at: new Date().toISOString() })
    .eq("id", parsed.data.contestId).neq("status", "FINALIZED").select("id").maybeSingle();
  if (error) return jsonError("I couldn't finalize that contest.", 503, "CONTEST_FINALIZE_FAILED");
  if (!finalized) return jsonError("This contest is already finalized.", 409, "CONTEST_FINALIZED");
  await auditAdmin(request, admin.session.email, "contest.finalize", "cabi_image_contest", parsed.data.contestId, "success", { winnerEntryId: parsed.data.entryId });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
