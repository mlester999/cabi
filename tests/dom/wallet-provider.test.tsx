import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import { WalletProvider, useWallet } from "@/components/wallet/wallet-provider";
import { emptyPublicWalletConfig } from "@/lib/wallet/client";

function Harness() {
  const wallet = useWallet();
  return (
    <div>
      <span>{wallet.sessionLoaded ? (wallet.authenticated ? "authenticated" : "guest") : "loading"}</span>
      <span>{wallet.error ?? "no error"}</span>
      <button onClick={() => void wallet.disconnect()}>Disconnect test wallet</button>
    </div>
  );
}

describe("wallet provider session lifecycle", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/wallet/session")) {
        return Response.json({
          authenticated: true,
          wallet: {
            address: "0x00000000000000000000000000000000000000A1",
            walletAccountId: "wallet-a",
            profileId: "profile-a",
          },
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
      }
      if (url.endsWith("/api/public/config")) return Response.json(emptyPublicWalletConfig);
      if (url.endsWith("/api/wallet/logout") && init?.method === "POST") return Response.json({ ok: true });
      return new Response(null, { status: 404 });
    }));
  });

  it("clears local authenticated state immediately after disconnect", async () => {
    render(<WalletProvider><Harness /></WalletProvider>);
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect test wallet" }));
    await waitFor(() => expect(screen.getByText("guest")).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith("/api/wallet/logout", { method: "POST" });
  });

  it("keeps the retryable local session when server-side revocation fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/wallet/session")) return Response.json({ authenticated: true, wallet: { address: "0x00000000000000000000000000000000000000A1", walletAccountId: "wallet-a", profileId: "profile-a" }, expiresAt: new Date(Date.now() + 60_000).toISOString() });
      if (url.endsWith("/api/public/config")) return Response.json(emptyPublicWalletConfig);
      if (url.endsWith("/api/wallet/logout")) return Response.json({ error: "Wallet sign-out could not be completed. Please try again." }, { status: 503 });
      return new Response(null, { status: 404 });
    }));
    render(<WalletProvider><Harness /></WalletProvider>);
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect test wallet" }));
    await waitFor(() => expect(screen.getByText("Wallet sign-out could not be completed. Please try again.")).toBeInTheDocument());
    expect(screen.getByText("authenticated")).toBeInTheDocument();
  });
});
