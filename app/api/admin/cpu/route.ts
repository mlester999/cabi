import { adminOrResponse } from "@/lib/admin/auth";
import { auditAdmin } from "@/lib/admin/audit";
import { CPU_MAX_ACCESS_BALANCE } from "@/lib/cpu-access/config";
import { cpuAccessGateSettingKey, readCpuAccessGateSettings, writeCpuAccessGateSettings } from "@/lib/cpu-access/settings.server";
import { getServiceClient } from "@/lib/db/supabase";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { defaultChainConfig, defaultCpuConfig, getWalletProductConfig, parseWalletProductConfig } from "@/lib/wallet/config";
import { z } from "zod";

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

const gatePatchSchema = z.object({
  enabled: z.boolean().optional(),
  minimumBalance: z.number().int().min(1).max(CPU_MAX_ACCESS_BALANCE).optional(),
  allowAdminBypass: z.boolean().optional(),
});

export async function GET() {
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;
  const databaseReady = Boolean(getServiceClient());
  const value = databaseReady ? await getWalletProductConfig() : { ...defaultChainConfig, cpu: defaultCpuConfig };
  const { settings, source } = await readCpuAccessGateSettings({ fresh: true });
  return Response.json(
    {
      value,
      databaseReady,
      // Read-only for the gate's identity: the contract, chain, and buy URL are
      // shipped constants, never a form field.
      gate: {
        enabled: settings.enabled,
        minimumBalance: settings.minimumBalance,
        allowAdminBypass: settings.allowAdminBypass,
        contract: settings.contract,
        chainId: settings.chainId,
        rpcUrl: settings.rpcUrl,
        buyUrl: settings.buyUrl,
        source,
        settingKey: cpuAccessGateSettingKey,
      },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function PATCH(request: Request) {
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return jsonError("Invalid CPU or chain configuration.", 400, "INVALID_INPUT");

  // The access-gate section saves on its own so an owner can change the
  // requirement without resubmitting (and re-validating) the whole token
  // publication form.
  if (body.section === "gate") {
    const parsed = gatePatchSchema.safeParse(body.gate ?? {});
    if (!parsed.success) {
      return jsonError(`Minimum holdings must be a whole number between 1 and ${CPU_MAX_ACCESS_BALANCE.toLocaleString("en-US")}.`, 400, "INVALID_INPUT");
    }
    const before = (await readCpuAccessGateSettings({ fresh: true })).settings;
    let saved;
    try {
      saved = await writeCpuAccessGateSettings(parsed.data, auth.session!.email);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "INVALID_MINIMUM_BALANCE") return jsonError("Minimum holdings must be a whole number of at least 1.", 400, "INVALID_INPUT");
      if (message === "DATABASE_NOT_CONFIGURED") return jsonError("Supabase must be connected first.", 503, "DATABASE_NOT_CONFIGURED");
      return jsonError("Couldn't save the CPU access gate. Check the Supabase connection and try again.", 503, "SAVE_FAILED");
    }
    // Only the fields that actually changed are audited, and the contract, chain
    // and buy URL are recorded every time the gate is saved so a change to any
    // of them can never be silent.
    await auditAdmin(request, auth.session!.email, "cpu.access_gate_update", "app_settings", cpuAccessGateSettingKey, "success", {
      changed: {
        enabled: before.enabled !== saved.enabled ? { from: before.enabled, to: saved.enabled } : undefined,
        minimumBalance: before.minimumBalance !== saved.minimumBalance ? { from: before.minimumBalance, to: saved.minimumBalance } : undefined,
        allowAdminBypass: before.allowAdminBypass !== saved.allowAdminBypass ? { from: before.allowAdminBypass, to: saved.allowAdminBypass } : undefined,
      },
      contract: saved.contract,
      chainId: saved.chainId,
      buyUrl: saved.buyUrl,
    });
    return Response.json({ gate: saved }, { headers: { "Cache-Control": "private, no-store" } });
  }

  let value;
  try { value = parseWalletProductConfig(body); } catch (error) {
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
