import { adminOrResponse } from "@/lib/admin/auth";
import { auditAdmin } from "@/lib/admin/audit";
import { getServiceClient } from "@/lib/db/supabase";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { defaultChainConfig, defaultCpuConfig, getWalletProductConfig, parseWalletProductConfig } from "@/lib/wallet/config";

const knownCpuSaveErrors = [
  "invalid chain configuration",
  "invalid supported chain",
  "duplicate chain id",
  "primary chain must be enabled",
  "invalid CPU launch status",
  "invalid CPU contract address",
  "CPU chain must be enabled",
  "live CPU configuration is incomplete",
  "invalid Clank.trade URL",
  "live CPU chain must be enabled",
];

function cpuSaveError(error: unknown) {
  const details = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
  const code = typeof details.code === "string" ? details.code : "";
  const message = typeof details.message === "string" ? details.message : "";

  if (code === "PGRST202" || /replace_wallet_product_config/i.test(message)) {
    return jsonError("The CPU save function is missing in Supabase. Apply migrations 0006–0008, then redeploy.", 503, "DATABASE_SCHEMA_OUTDATED");
  }

  const known = knownCpuSaveErrors.find((candidate) => message.toLowerCase().includes(candidate.toLowerCase()));
  if (known) return jsonError(`CPU settings rejected: ${known}.`, 400, "INVALID_INPUT");

  return jsonError("Couldn't save CPU settings. Check that the Supabase migrations are applied and the server-only service-role key is valid.", 503, "SAVE_FAILED");
}

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
  if (error) return cpuSaveError(error);
  await auditAdmin(request, auth.session!.email, "cpu.update", "cpu_settings", "singleton", "success", {
    launchStatus: value.cpu.launchStatus,
    chainId: value.cpu.chainId,
    configuredChains: value.chains.length,
    hasTradeUrl: Boolean(value.cpu.clankTradeUrl),
  });
  return Response.json({ value });
}
