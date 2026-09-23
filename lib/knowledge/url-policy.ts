export type UrlPolicy = { rootUrl: string; allowedHosts: string[]; maxDepth: number; maxPages: number; maxBytes: number };

export const defaultClankPolicy: UrlPolicy = { rootUrl: "https://clank.trade/", allowedHosts: ["clank.trade"], maxDepth: 2, maxPages: 20, maxBytes: 1_500_000 };

const droppedParams = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"]);

export function normalizePublicUrl(input: string, policy: UrlPolicy = defaultClankPolicy, base?: string) {
  let url: URL;
  try { url = new URL(input, base ?? policy.rootUrl); } catch { throw new Error("INVALID_URL"); }
  if (url.protocol !== "https:") throw new Error("HTTPS_REQUIRED");
  if (url.username || url.password) throw new Error("URL_CREDENTIALS_FORBIDDEN");
  if (url.port && url.port !== "443") throw new Error("NONSTANDARD_PORT_FORBIDDEN");
  const host = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (!policy.allowedHosts.map((item) => item.toLowerCase()).includes(host)) throw new Error("HOST_NOT_ALLOWED");
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(host) || host === "localhost" || host.endsWith(".local")) throw new Error("IP_OR_LOCAL_HOST_FORBIDDEN");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (droppedParams.has(key.toLowerCase())) url.searchParams.delete(key);
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/{2,}/gu, "/");
  return url.toString();
}

export function isCrawlablePath(url: string) {
  const parsed = new URL(url);
  if (/\.(?:png|jpe?g|gif|webp|svg|ico|pdf|zip|mp4|mp3|json|xml)$/iu.test(parsed.pathname)) return false;
  if (/\/(?:login|sign-in|account|portfolio|wallet|api)(?:\/|$)/iu.test(parsed.pathname)) return false;
  return true;
}
