import "server-only";
import { getServiceClient } from "@/lib/db/supabase";

type Personality = { systemPrompt?: string; defaultMood?: string };
type CpuConfig = { coinName?: string; ticker?: string; contractAddress?: string; clankUrl?: string; xUrl?: string; launchStatus?: string; description?: string; announcement?: string };

export async function getCabiRuntimeConfig() {
  const db = getServiceClient(); if (!db) return { personality: null, cpu: null };
  const [{ data: personality }, { data: cpu }] = await Promise.all([
    db.from("app_settings").select("value_json").eq("key", "personality").maybeSingle(),
    db.from("app_settings").select("value_json").eq("key", "cpu_config").maybeSingle(),
  ]);
  const cpuValue = (cpu?.value_json as CpuConfig | null) ?? null;
  const trustedCpu = cpuValue ? Object.fromEntries(Object.entries(cpuValue).filter(([, value]) => value !== "" && value != null)) : null;
  return { personality: (personality?.value_json as Personality | null) ?? null, cpu: trustedCpu && Object.keys(trustedCpu).length ? trustedCpu : null };
}
