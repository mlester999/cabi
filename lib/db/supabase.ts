import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, supabaseConfigured } from "@/lib/config/env";

let serviceClient: SupabaseClient | undefined;

export function getServiceClient(): SupabaseClient | null {
  if (!supabaseConfigured()) return null;
  try {
    serviceClient ??= createClient(
      env("NEXT_PUBLIC_SUPABASE_URL")!,
      env("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }, global: { headers: { "X-Client-Info": "cabi-server/1.0" } } },
    );
  } catch {
    // A malformed deployment URL must not crash the public prelaunch page.
    return null;
  }
  return serviceClient;
}

export function requireServiceClient(): SupabaseClient {
  const client = getServiceClient();
  if (!client) throw new Error("DATABASE_NOT_CONFIGURED");
  return client;
}

export function sanitizeDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown database error";
  if (message.includes("DATABASE_NOT_CONFIGURED")) return "Cabi's memory connection hasn't been configured yet.";
  return "Cabi couldn't save that just now.";
}
