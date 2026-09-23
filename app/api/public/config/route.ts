import { getPublicWalletConfig } from "@/lib/wallet/config";

export async function GET() {
  const config = await getPublicWalletConfig();
  return Response.json(config, {
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
