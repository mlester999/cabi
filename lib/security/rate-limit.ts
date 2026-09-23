import "server-only";
import { getServiceClient } from "@/lib/db/supabase";
import { hashValue } from "@/lib/security/crypto";

type Bucket = { count: number; resetAt: number };
const localBuckets = new Map<string, Bucket>();

export async function checkRateLimit(scope: string, subject: string, limit: number, windowSeconds: number) {
  const keyHash = await hashValue(`${scope}:${subject}`);
  const db = getServiceClient();
  if (db) {
    const { data, error } = await db.rpc("consume_rate_limit", { p_scope: scope, p_key_hash: keyHash, p_limit: limit, p_window_seconds: windowSeconds });
    if (!error && data) {
      const result = Array.isArray(data) ? data[0] : data;
      return { allowed: Boolean(result.allowed), remaining: Number(result.remaining ?? 0), retryAfter: Number(result.retry_after ?? windowSeconds) };
    }
    if (scope.startsWith("admin") || scope.startsWith("ai")) return { allowed: false, remaining: 0, retryAfter: windowSeconds };
  }
  const now = Date.now();
  const existing = localBuckets.get(keyHash);
  const bucket = !existing || existing.resetAt <= now ? { count: 0, resetAt: now + windowSeconds * 1000 } : existing;
  bucket.count += 1;
  localBuckets.set(keyHash, bucket);
  return { allowed: bucket.count <= limit, remaining: Math.max(0, limit - bucket.count), retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
}
