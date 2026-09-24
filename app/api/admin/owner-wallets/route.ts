import { z } from "zod";

import { adminOrResponse } from "@/lib/admin/auth";
import { auditAdmin } from "@/lib/admin/audit";
import { assertSameOrigin, jsonError } from "@/lib/security/request";
import { disableOwnerWallet, listOwnerWallets, saveOwnerWallet } from "@/lib/site/owner-wallets";
import { normalizeWalletAddress } from "@/lib/wallet/address";

const addSchema = z.object({
  walletAddress: z.string().trim(),
  label: z.string().trim().max(100).default(""),
  confirmed: z.literal(true),
});
const removeSchema = z.object({ walletAddress: z.string().trim(), confirmed: z.literal(true) });

export async function GET() {
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;
  try {
    return Response.json({ wallets: await listOwnerWallets() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return jsonError("Owner wallets are temporarily unavailable.", 503, "OWNER_WALLETS_UNAVAILABLE");
  }
}

export async function POST(request: Request) {
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const parsed = addSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Confirm and enter a valid wallet address and label.", 400, "INVALID_INPUT");
  let address;
  try { address = normalizeWalletAddress(parsed.data.walletAddress); }
  catch { return jsonError("Enter a valid EVM wallet address.", 400, "INVALID_WALLET_ADDRESS"); }
  try {
    const wallets = await saveOwnerWallet(address.address, parsed.data.label);
    await auditAdmin(request, auth.session!.email, "owner_wallet.add", "admin_wallets", address.uniqueKey, "success", { label: parsed.data.label });
    return Response.json({ wallets }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return jsonError("Could not save that wallet.", 503, "OWNER_WALLET_SAVE_FAILED");
  }
}

export async function DELETE(request: Request) {
  const auth = await adminOrResponse();
  if (auth.response) return auth.response;
  try { assertSameOrigin(request); } catch { return jsonError("Invalid request.", 403, "INVALID_ORIGIN"); }
  const parsed = removeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Confirm and choose a valid wallet address.", 400, "INVALID_INPUT");
  let address;
  try { address = normalizeWalletAddress(parsed.data.walletAddress); }
  catch { return jsonError("Enter a valid EVM wallet address.", 400, "INVALID_WALLET_ADDRESS"); }
  try {
    const wallets = await disableOwnerWallet(address.address);
    await auditAdmin(request, auth.session!.email, "owner_wallet.remove", "admin_wallets", address.uniqueKey, "success");
    return Response.json({ wallets }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return jsonError("Could not remove that wallet.", 503, "OWNER_WALLET_SAVE_FAILED");
  }
}
