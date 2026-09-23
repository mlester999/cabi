import "server-only";
import { getServiceClient } from "@/lib/db/supabase";
import { getPublicWalletConfig } from "@/lib/wallet/config";

type Personality = { systemPrompt?: string; defaultMood?: string };

export async function getCabiRuntimeConfig() {
  const db = getServiceClient();
  const [personalityResult, publicConfig] = await Promise.all([
    db ? db.from("app_settings").select("value_json").eq("key", "personality").maybeSingle() : Promise.resolve({ data: null }),
    getPublicWalletConfig(),
  ]);
  const { cpu, chains } = publicConfig;
  const chain = cpu.chainId == null ? null : chains.find((candidate) => candidate.id === cpu.chainId && candidate.enabled) ?? null;
  const trustedCpu = cpu.launchStatus === "LIVE" ? {
    tokenName: cpu.tokenName,
    ticker: cpu.ticker,
    launchStatus: cpu.launchStatus,
    contractAddress: cpu.contractAddress,
    network: chain?.name,
    chainId: chain?.id,
    clankTradeUrl: cpu.clankTradeUrl,
    explorerUrl: cpu.explorerUrl || (chain && cpu.contractAddress ? `${chain.blockExplorerUrl.replace(/\/$/u, "")}/address/${cpu.contractAddress}` : undefined),
    xUrl: cpu.xUrl || undefined,
    websiteUrl: cpu.websiteUrl || undefined,
    description: cpu.description || undefined,
  } : {
    tokenName: cpu.tokenName,
    ticker: cpu.ticker,
    launchStatus: "PRELAUNCH",
  };
  return { personality: (personalityResult.data?.value_json as Personality | null) ?? null, cpu: trustedCpu, publicWallet: publicConfig };
}
