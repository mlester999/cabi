import { adminOrResponse } from "@/lib/admin/auth";
import { auditAdmin } from "@/lib/admin/audit";
import { getServiceClient } from "@/lib/db/supabase";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { defaultChainConfig, defaultCpuConfig, getWalletProductConfig, parseWalletProductConfig } from "@/lib/wallet/config";

export async function GET() {
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;
  const databaseReady = Boolean(getServiceClient());
  const value = databaseReady ? await getWalletProductConfig() : { ...defaultChainConfig, cpu: defaultCpuConfig };
  return Response.json({ value, databaseReady }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request) {
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  let value;
  try { value = parseWalletProductConfig(await request.json()); } catch (error) {
    const details = error && typeof error === "object" && "issues" in error ? (error as { issues: Array<{ message: string }> }).issues.map((issue) => issue.message) : undefined;
    return Response.json({ error: details?.[0] ?? "Invalid CPU or chain configuration.", code: "INVALID_INPUT", details }, { status: 400 });
  }
  const db = getServiceClient();
  if (!db) return jsonError("Supabase must be connected first.", 503, "DATABASE_NOT_CONFIGURED");
  const { error } = await db.rpc("replace_wallet_product_config", {
    p_chains: value.chains,
    p_primary_chain_id: value.primaryChainId,
    p_cpu: value.cpu,
  });
  if (error) return jsonError("Couldn't save CPU settings.", 503, "SAVE_FAILED");
  await auditAdmin(request, auth.session!.email, "cpu.update", "cpu_settings", "singleton", "success", {
    launchStatus: value.cpu.launchStatus,
    chainId: value.cpu.chainId,
    configuredChains: value.chains.length,
    hasTradeUrl: Boolean(value.cpu.clankTradeUrl),
  });
  return Response.json({ value });
}
