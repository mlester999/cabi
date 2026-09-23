import "server-only";

import { getAddress, isAddress } from "viem";
import { z } from "zod";

import { getServiceClient } from "@/lib/db/supabase";
import { fallbackCpuContractAddress, fallbackCpuDescription, fallbackCpuTradeUrl } from "@/lib/wallet/public-defaults";

export type SupportedChainConfig = {
  id: number;
  name: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrl: string;
  blockExplorerUrl: string;
  iconUrl: string;
  enabled: boolean;
};

export type CpuTokenConfig = {
  tokenName: string;
  ticker: string;
  launchStatus: "PRELAUNCH" | "LIVE";
  contractAddress: string;
  chainId: number | null;
  clankTradeUrl: string;
  explorerUrl: string;
  xUrl: string;
  websiteUrl: string;
  description: string;
};

export type PublicWalletConfig = {
  chains: SupportedChainConfig[];
  primaryChainId: number | null;
  cpu: CpuTokenConfig;
};

export const defaultCpuConfig: CpuTokenConfig = {
  tokenName: "Cat Partner Unit",
  ticker: "CPU",
  launchStatus: "PRELAUNCH",
  contractAddress: fallbackCpuContractAddress,
  chainId: null,
  clankTradeUrl: fallbackCpuTradeUrl,
  explorerUrl: "",
  xUrl: "",
  websiteUrl: "",
  description: fallbackCpuDescription,
};

export const defaultChainConfig = { chains: [] as SupportedChainConfig[], primaryChainId: null as number | null };

export const httpsUrlOrEmpty = z.string().trim().max(2_000).refine(
  (value) => !value || value.startsWith("https://"),
  "Use a complete HTTPS URL.",
);

const clankTradeUrlOrEmpty = z.string().trim().max(2_000).refine((value) => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname.toLowerCase() === "clank.trade" || url.hostname.toLowerCase() === "www.clank.trade") &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}, "Use the exact HTTPS Clank.trade coin URL.");

const rpcUrl = z.string().trim().url().max(2_000).refine(
  (value) => value.startsWith("https://"),
  "RPC URLs must use HTTPS.",
);

export const supportedChainSchema = z.object({
  id: z.number().int().positive().max(2_147_483_647),
  name: z.string().trim().min(1).max(80),
  nativeCurrency: z.object({
    name: z.string().trim().min(1).max(80),
    symbol: z.string().trim().min(1).max(12),
    decimals: z.number().int().min(0).max(36).default(18),
  }),
  rpcUrl,
  blockExplorerUrl: z.string().trim().url().max(2_000).refine((value) => value.startsWith("https://"), "Explorer URLs must use HTTPS."),
  iconUrl: httpsUrlOrEmpty.or(z.string().trim().regex(/^\/[A-Za-z0-9_./-]+$/u).max(500)),
  enabled: z.boolean(),
});

export const chainConfigSchema = z.object({
  chains: z.array(supportedChainSchema).max(20),
  primaryChainId: z.number().int().positive().max(2_147_483_647).nullable(),
}).superRefine((value, context) => {
  const ids = new Set<number>();
  value.chains.forEach((chain, index) => {
    if (ids.has(chain.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["chains", index, "id"], message: "Chain IDs must be unique." });
    ids.add(chain.id);
  });
  if (value.primaryChainId != null && !value.chains.some((chain) => chain.id === value.primaryChainId && chain.enabled)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["primaryChainId"], message: "The primary chain must be an enabled supported chain." });
  }
});

export const cpuTokenConfigSchema = z.object({
  tokenName: z.string().trim().min(1).max(100),
  ticker: z.string().trim().min(1).max(12).transform((value) => value.toUpperCase()),
  launchStatus: z.enum(["PRELAUNCH", "LIVE"]),
  contractAddress: z.string().trim().max(100),
  chainId: z.number().int().positive().max(2_147_483_647).nullable(),
  clankTradeUrl: clankTradeUrlOrEmpty,
  explorerUrl: httpsUrlOrEmpty,
  xUrl: httpsUrlOrEmpty,
  websiteUrl: httpsUrlOrEmpty,
  description: z.string().trim().max(2_000),
});

export const walletProductConfigSchema = z.object({
  chains: z.array(supportedChainSchema).max(20),
  primaryChainId: z.number().int().positive().max(2_147_483_647).nullable(),
  cpu: cpuTokenConfigSchema,
}).superRefine((value, context) => {
  const parsedChains = chainConfigSchema.safeParse({ chains: value.chains, primaryChainId: value.primaryChainId });
  if (!parsedChains.success) {
    for (const issue of parsedChains.error.issues) context.addIssue({ ...issue, path: issue.path });
  }
  if (value.cpu.contractAddress && !isAddress(value.cpu.contractAddress, { strict: false })) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["cpu", "contractAddress"], message: "Enter a valid EVM contract address." });
  }
  if (value.cpu.launchStatus === "LIVE") {
    if (!value.cpu.contractAddress) context.addIssue({ code: z.ZodIssueCode.custom, path: ["cpu", "contractAddress"], message: "A contract address is required before launch." });
    if (value.cpu.chainId == null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["cpu", "chainId"], message: "A supported chain is required before launch." });
    if (!value.cpu.clankTradeUrl) context.addIssue({ code: z.ZodIssueCode.custom, path: ["cpu", "clankTradeUrl"], message: "The exact Clank.trade coin URL is required before launch." });
  }
  if (value.cpu.chainId != null && !value.chains.some((chain) => chain.id === value.cpu.chainId && chain.enabled)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["cpu", "chainId"], message: "CPU must use an enabled supported chain." });
  }
});

function normalizeCpu(config: CpuTokenConfig): CpuTokenConfig {
  return {
    ...config,
    contractAddress: config.contractAddress ? getAddress(config.contractAddress.toLowerCase()) : "",
  };
}

export function parseWalletProductConfig(value: unknown): PublicWalletConfig {
  const parsed = walletProductConfigSchema.parse(value);
  return { ...parsed, cpu: normalizeCpu(parsed.cpu) };
}

/** Full owner-managed product configuration. Keep this server-only and use it
 * only behind admin authorization; PRELAUNCH may contain staged launch data. */
export async function getWalletProductConfig(): Promise<PublicWalletConfig> {
  const db = getServiceClient();
  if (!db) return { ...defaultChainConfig, cpu: defaultCpuConfig };
  const [{ data: chainRows, error: chainError }, { data: cpuRow, error: cpuError }] = await Promise.all([
    db.from("chain_configs").select("chain_id,chain_name,native_currency_name,native_currency_symbol,native_currency_decimals,rpc_url,block_explorer_url,icon_url,enabled,is_primary").order("chain_name"),
    db.from("cpu_settings").select("launch_status,token_name,ticker,contract_address,chain_id,clank_trade_url,block_explorer_url,x_url,website_url,description").eq("singleton", true).maybeSingle(),
  ]);
  if (chainError || cpuError) return { ...defaultChainConfig, cpu: defaultCpuConfig };
  const primary = chainRows?.find((row) => row.is_primary);
  const chains = chainConfigSchema.safeParse({
    chains: (chainRows ?? []).map((row) => ({
      id: Number(row.chain_id),
      name: row.chain_name,
      nativeCurrency: { name: row.native_currency_name, symbol: row.native_currency_symbol, decimals: Number(row.native_currency_decimals) },
      rpcUrl: row.rpc_url,
      blockExplorerUrl: row.block_explorer_url ?? "",
      iconUrl: row.icon_url ?? "",
      enabled: row.enabled,
    })),
    primaryChainId: primary ? Number(primary.chain_id) : null,
  });
  const cpu = cpuTokenConfigSchema.safeParse(cpuRow ? {
    tokenName: cpuRow.token_name,
    ticker: cpuRow.ticker,
    launchStatus: cpuRow.launch_status,
    contractAddress: cpuRow.contract_address || fallbackCpuContractAddress,
    chainId: cpuRow.chain_id == null ? null : Number(cpuRow.chain_id),
    clankTradeUrl: cpuRow.clank_trade_url || fallbackCpuTradeUrl,
    explorerUrl: cpuRow.block_explorer_url ?? "",
    xUrl: cpuRow.x_url ?? "",
    websiteUrl: cpuRow.website_url ?? "",
    description: cpuRow.description?.trim() || fallbackCpuDescription,
  } : defaultCpuConfig);
  const candidate = {
    ...(chains.success ? chains.data : defaultChainConfig),
    cpu: cpu.success ? cpu.data : defaultCpuConfig,
  };
  const complete = walletProductConfigSchema.safeParse(candidate);
  if (!complete.success) return { ...(chains.success ? chains.data : defaultChainConfig), cpu: defaultCpuConfig };
  return { ...complete.data, cpu: normalizeCpu(complete.data.cpu) };
}

/** Public projection. Staged token destinations are not publication-ready and
 * must never leak through JSON, RSC payloads, or a prelaunch page. */
export function redactUnlaunchedCpu(config: PublicWalletConfig): PublicWalletConfig {
  if (config.cpu.launchStatus === "LIVE") return config;
  return {
    ...config,
    cpu: {
      ...config.cpu,
      contractAddress: "",
      chainId: null,
      clankTradeUrl: "",
      explorerUrl: "",
      xUrl: "",
      websiteUrl: "",
    },
  };
}

export async function getPublicWalletConfig(): Promise<PublicWalletConfig> {
  return redactUnlaunchedCpu(await getWalletProductConfig());
}
