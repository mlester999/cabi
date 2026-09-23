import "server-only";

const truthy = new Set(["1", "true", "yes", "on"]);

export function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function envBoolean(name: string, fallback = false): boolean {
  const value = env(name);
  return value ? truthy.has(value.toLowerCase()) : fallback;
}

export function isProduction() {
  return process.env.NODE_ENV === "production";
}

export function publicAppUrl() {
  return env("APP_URL") ?? "http://localhost:5173";
}

export function supabaseConfigured() {
  return Boolean(env("NEXT_PUBLIC_SUPABASE_URL") && env("SUPABASE_SERVICE_ROLE_KEY"));
}

export function aiEnvironmentConfigured() {
  return Boolean(env("DEEPSEEK_API_KEY"));
}
