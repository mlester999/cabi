import { isCpuGateEvent, recordCpuGateEvent } from "@/lib/cpu-access/analytics.server";
import { cpuBuyUrlFor } from "@/lib/cpu-access/config";
import { readCpuAccessGateSettings } from "@/lib/cpu-access/settings.server";
import { cpuHolderStatusPayload } from "@/lib/cpu-access/status.server";
import { resolveCabiAccessForSession } from "@/lib/cpu-access/resolve";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { getSiteMode } from "@/lib/site/mode";
import { readWalletAuth } from "@/lib/wallet/session";

export const dynamic = "force-dynamic";

/**
 * Current holder-gate status for the signed-in wallet.
 *
 * The session cookie decides whose balance is read, so this endpoint cannot be
 * used to probe another wallet, and waiting on it is not what grants access -
 * every protected API repeats the same server-side decision for itself.
 */
export async function GET() {
  const [{ mode }, session] = await Promise.all([
    getSiteMode(),
    readWalletAuth().catch(() => null),
  ]);
  const { settings } = await readCpuAccessGateSettings();
  const buyUrl = cpuBuyUrlFor(settings.buyUrl);
  if (!settings.enabled) {
    return Response.json(
      {
        allowed: true,
        reason: "ALLOWED",
        live: mode === "LIVE",
        cpuGateBypassed: false,
        walletAddress: session?.walletAddress ?? null,
        balance: null,
        balanceTruncated: false,
        required: null,
        deficit: null,
        symbol: null,
        message: null,
        buyUrl,
        gateEnabled: false,
        mode,
        minimumBalance: settings.minimumBalance,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const decision = await resolveCabiAccessForSession(session, { mode });
  const payload = cpuHolderStatusPayload(decision, buyUrl);
  // Two of the four gate events describe an outcome rather than a click, so they
  // are recorded where the outcome is decided. Balances are never stored.
  if (session && mode === "LIVE" && payload.reason === "INSUFFICIENT_CPU") {
    await recordCpuGateEvent({ event: "cpu_gate_failed", walletAccountId: session.walletAccountId, siteMode: mode });
  }
  if (session && mode === "LIVE" && payload.allowed) {
    await recordCpuGateEvent({ event: "cpu_gate_passed", walletAccountId: session.walletAccountId, siteMode: mode });
  }
  return Response.json(
    {
      ...payload,
      gateEnabled: true,
      mode,
      minimumBalance: settings.minimumBalance,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/** Records one of the four privacy-conscious gate events. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch {
    return jsonError("Invalid request.", 403, "INVALID_ORIGIN");
  }
  const body = await request.json().catch(() => null) as { event?: unknown } | null;
  if (!body || !isCpuGateEvent(body.event)) return jsonError("Unknown event.", 400, "INVALID_EVENT");
  // Events are attributed to a signed-in wallet, otherwise dropped, so an
  // anonymous caller cannot inflate them.
  const [session, { mode }] = await Promise.all([
    readWalletAuth().catch(() => null),
    getSiteMode(),
  ]);
  if (session) await recordCpuGateEvent({ event: body.event, walletAccountId: session.walletAccountId, siteMode: mode });
  return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
}
