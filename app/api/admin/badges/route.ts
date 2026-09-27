import { z } from "zod";

import { adminOrResponse } from "@/lib/admin/auth";
import { auditAdmin } from "@/lib/admin/audit";
import { getServiceClient } from "@/lib/db/supabase";
import { normalizeUsername } from "@/lib/profiles/username";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { guardAppApiCpu } from "@/lib/site/guard";

export const dynamic = "force-dynamic";

const badgeColumns = "id,slug,label,description,icon_key,color_key,created_by,created_at";
const iconKey = z.enum(["award", "star", "sparkles", "crown", "heart", "image", "leaf"]);
const colorKey = z.enum(["violet", "teal", "amber", "rose", "blue"]);

export async function GET() {
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  const admin = await adminOrResponse();
  if (admin.response) return admin.response;
  const db = getServiceClient();
  if (!db) return jsonError("Profile badges are not configured.", 503, "DATABASE_NOT_CONFIGURED");
  const { data: badges, error } = await db.from("cabi_profile_badges").select(badgeColumns).order("created_at", { ascending: false }).limit(500);
  if (error) return jsonError("Profile badges are not available right now.", 503, "BADGES_UNAVAILABLE");
  const ids = (badges ?? []).map((badge) => String(badge.id));
  const { data: awards, error: awardsError } = ids.length
    ? await db.from("cabi_profile_badge_awards").select("badge_id").in("badge_id", ids).limit(20_000)
    : { data: [], error: null };
  if (awardsError) return jsonError("Profile badge assignments are not available right now.", 503, "BADGE_ASSIGNMENTS_UNAVAILABLE");
  const counts = new Map<string, number>();
  for (const award of awards ?? []) {
    const id = String(award.badge_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return Response.json({ badges: (badges ?? []).map((badge) => ({
    id: String(badge.id), slug: String(badge.slug), label: String(badge.label),
    description: String(badge.description ?? ""), icon: String(badge.icon_key),
    color: String(badge.color_key), createdBy: String(badge.created_by),
    createdAt: String(badge.created_at), awardCount: counts.get(String(badge.id)) ?? 0,
  })) }, { headers: { "Cache-Control": "private, no-store" } });
}

const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), label: z.string().trim().min(2).max(40), description: z.string().trim().max(240), icon: iconKey, color: colorKey }),
  z.object({ action: z.literal("assign"), badgeId: z.string().uuid(), username: z.string().trim().min(2).max(40) }),
  z.object({ action: z.literal("revoke"), badgeId: z.string().uuid(), username: z.string().trim().min(2).max(40) }),
]);

function badgeSlug(label: string) {
  return label.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64).replace(/-$/g, "");
}

export async function POST(request: Request) {
  const blocked = await guardAppApiCpu();
  if (blocked) return blocked;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const admin = await adminOrResponse();
  if (admin.response) return admin.response;
  const parsed = mutationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Check the badge details and try again.", 400, "INVALID_INPUT");
  const db = getServiceClient();
  if (!db) return jsonError("Profile badges are not configured.", 503, "DATABASE_NOT_CONFIGURED");

  if (parsed.data.action === "create") {
    const slug = badgeSlug(parsed.data.label);
    if (slug.length < 2) return jsonError("Use a badge name with at least two letters or numbers.", 400, "INVALID_LABEL");
    const { data, error } = await db.from("cabi_profile_badges").insert({
      slug,
      label: parsed.data.label,
      description: parsed.data.description,
      icon_key: parsed.data.icon,
      color_key: parsed.data.color,
      created_by: admin.session.email,
    }).select("id").maybeSingle();
    if (error?.code === "23505") return jsonError("A badge with that name already exists.", 409, "BADGE_EXISTS");
    if (error || !data) return jsonError("I couldn't create that badge.", 503, "BADGE_CREATE_FAILED");
    await auditAdmin(request, admin.session.email, "profile_badge.create", "cabi_profile_badge", String(data.id), "success", { slug, label: parsed.data.label, icon: parsed.data.icon, color: parsed.data.color });
    return Response.json({ ok: true, id: String(data.id) }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const username = normalizeUsername(parsed.data.username);
  if (!username) return jsonError("Enter a valid profile name.", 400, "INVALID_USERNAME");
  const [{ data: badge }, { data: profile }] = await Promise.all([
    db.from("cabi_profile_badges").select("id,label").eq("id", parsed.data.badgeId).maybeSingle(),
    db.from("profiles").select("wallet_account_id,username,profile_completed_at").eq("username", username).maybeSingle(),
  ]);
  if (!badge) return jsonError("That badge could not be found.", 404, "BADGE_NOT_FOUND");
  if (!profile?.wallet_account_id || !profile.profile_completed_at) return jsonError("That completed profile could not be found.", 404, "PROFILE_NOT_FOUND");

  if (parsed.data.action === "assign") {
    const { error } = await db.from("cabi_profile_badge_awards").insert({ badge_id: parsed.data.badgeId, wallet_account_id: profile.wallet_account_id, assigned_by: admin.session.email });
    if (error?.code === "23505") return jsonError("That badge is already assigned to this profile.", 409, "BADGE_ALREADY_ASSIGNED");
    if (error) return jsonError("I couldn't assign that badge.", 503, "BADGE_ASSIGN_FAILED");
    await auditAdmin(request, admin.session.email, "profile_badge.assign", "cabi_profile_badge_award", `${parsed.data.badgeId}:${profile.wallet_account_id}`, "success", { badgeId: parsed.data.badgeId, username: profile.username });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const { error } = await db.from("cabi_profile_badge_awards").delete().eq("badge_id", parsed.data.badgeId).eq("wallet_account_id", profile.wallet_account_id);
  if (error) return jsonError("I couldn't remove that badge assignment.", 503, "BADGE_REVOKE_FAILED");
  await auditAdmin(request, admin.session.email, "profile_badge.revoke", "cabi_profile_badge_award", `${parsed.data.badgeId}:${profile.wallet_account_id}`, "success", { badgeId: parsed.data.badgeId, username: profile.username });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
