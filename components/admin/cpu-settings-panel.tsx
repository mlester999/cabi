"use client";

import { Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

import { Banner, Header } from "@/components/admin/ai-settings-panel";
import { fallbackCpuDescription } from "@/lib/wallet/public-defaults";

type Chain = {
  id: number;
  name: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrl: string;
  blockExplorerUrl: string;
  iconUrl: string;
  enabled: boolean;
};

type Cpu = {
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

type Value = { chains: Chain[]; primaryChainId: number | null; cpu: Cpu };

type Gate = {
  enabled: boolean;
  minimumBalance: number;
  allowAdminBypass: boolean;
  contract: string;
  chainId: number;
  rpcUrl: string;
  buyUrl: string;
  source: { enabled: string; minimumBalance: string; allowAdminBypass: string; contract: string };
  settingKey: string;
};

const emptyGate: Gate = {
  enabled: true,
  minimumBalance: 1_000_000,
  allowAdminBypass: true,
  contract: "0x1a421a5065316d9b4062939e9959ddece6630528",
  chainId: 4663,
  rpcUrl: "",
  buyUrl: "https://clank.trade/coin/0x1a421a5065316d9b4062939e9959ddece6630528",
  source: { enabled: "default", minimumBalance: "default", allowAdminBypass: "default", contract: "official" },
  settingKey: "cpu_access_gate",
};

const emptyValue: Value = {
  chains: [],
  primaryChainId: null,
  cpu: {
    tokenName: "Cat Partner Unit",
    ticker: "CPU",
    launchStatus: "PRELAUNCH",
    contractAddress: "",
    chainId: null,
    clankTradeUrl: "",
    explorerUrl: "",
    xUrl: "",
    websiteUrl: "",
    description: fallbackCpuDescription,
  },
};

const newChain = (): Chain => ({
  id: 1,
  name: "",
  nativeCurrency: { name: "", symbol: "", decimals: 18 },
  rpcUrl: "",
  blockExplorerUrl: "",
  iconUrl: "",
  enabled: true,
});

export function CpuSettingsPanel() {
  const [value, setValue] = useState<Value>(emptyValue);
  const [initial, setInitial] = useState<Value>(emptyValue);
  const [databaseReady, setDatabaseReady] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [gate, setGate] = useState<Gate>(emptyGate);
  const [gateInitial, setGateInitial] = useState<Gate>(emptyGate);
  const [gateBusy, setGateBusy] = useState(false);
  const [gateNotice, setGateNotice] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/cpu", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json() as { value: Value; databaseReady: boolean; gate?: Gate };
        setValue(payload.value);
        setInitial(payload.value);
        setDatabaseReady(payload.databaseReady);
        if (payload.gate) {
          setGate(payload.gate);
          setGateInitial(payload.gate);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const saveGate = async () => {
    setGateBusy(true);
    setGateNotice(undefined);
    try {
      const response = await fetch("/api/admin/cpu", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "gate",
          gate: { enabled: gate.enabled, minimumBalance: gate.minimumBalance, allowAdminBypass: gate.allowAdminBypass },
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; gate?: Omit<Gate, "source" | "settingKey"> };
      if (!response.ok) return setGateNotice(payload.error ?? "Save failed.");
      if (payload.gate) {
        const merged: Gate = { ...gate, ...payload.gate, source: gate.source, settingKey: gate.settingKey };
        setGate(merged);
        setGateInitial(merged);
      }
      setGateNotice("CPU access gate saved. The change is audited and takes effect within seconds.");
    } catch {
      setGateNotice("Couldn't reach the CPU settings API. Check the deployment and try again.");
    } finally {
      setGateBusy(false);
    }
  };

  const updateCpu = <Key extends keyof Cpu>(key: Key, next: Cpu[Key]) => {
    setValue((current) => ({ ...current, cpu: { ...current.cpu, [key]: next } }));
  };

  const updateChain = (index: number, patch: Partial<Chain>) => {
    setValue((current) => ({ ...current, chains: current.chains.map((chain, itemIndex) => itemIndex === index ? { ...chain, ...patch } : chain) }));
  };

  const updateCurrency = (index: number, patch: Partial<Chain["nativeCurrency"]>) => {
    setValue((current) => ({
      ...current,
      chains: current.chains.map((chain, itemIndex) => itemIndex === index
        ? { ...chain, nativeCurrency: { ...chain.nativeCurrency, ...patch } }
        : chain),
    }));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice(undefined);
    try {
      const response = await fetch("/api/admin/cpu", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; value?: Value };
      if (!response.ok) return setNotice(payload.error ?? "Save failed.");
      const saved = payload.value ?? value;
      setValue(saved);
      setInitial(saved);
      setNotice("CPU and supported-chain settings saved.");
    } catch {
      setNotice("Couldn't reach the CPU settings API. Check the deployment and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save}>
      <Header eyebrow="Cat Partner Unit" title="$CPU" description="Configure launch state and exact official links. Cabi never fabricates contract, network, or trading information." />
      {!databaseReady && <Banner>Connect Supabase before saving. The public page remains safely in pre-launch mode.</Banner>}

      {/* ------------------------------------------------------------------
          CPU Access Gate. The contract, the chain, and the buy URL are shipped
          constants and are shown read-only: the gate can only ever read the
          official $CPU token. The minimum and the two switches are saved
          server-side, validated, and audited.
         ------------------------------------------------------------------ */}
      <section className="mt-7 rounded-[24px] border border-violet-200/[0.12] bg-[#0e0c15] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">CPU Access Gate</h2>
            <p className="mt-1 max-w-xl text-xs leading-5 text-[#777180]">
              While the site is LIVE, a normal wallet must hold at least the minimum below to use Cabi. The balance is read
              on the server, straight from the official contract, using <code className="font-mono">balanceOf</code> and{" "}
              <code className="font-mono">decimals()</code>. Admin/owner wallets on the allowlist are exempt.
            </p>
          </div>
          <label className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-[#d5d0de]">
            <input type="checkbox" checked={gate.enabled} onChange={(event) => setGate((current) => ({ ...current, enabled: event.target.checked }))} className="accent-violet-300" />
            Gate enabled
          </label>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <Field label="Minimum $CPU Required for Access" help="Whole tokens. Server-side only.">
            <input
              className="field"
              type="number"
              min={1}
              step={1}
              value={gate.minimumBalance}
              onChange={(event) => setGate((current) => ({ ...current, minimumBalance: Number(event.target.value) }))}
            />
          </Field>
          <Field label="Official contract" help="Fixed. Read-only.">
            <input className="field font-mono" value={gate.contract} readOnly disabled />
          </Field>
          <Field label="CPU chain" help="Chain ID the balance is read from.">
            <input className="field" value={String(gate.chainId)} readOnly disabled />
          </Field>
          <Field label="Official buy URL" help="Fixed. The modal opens exactly this page in a new tab.">
            <input className="field font-mono text-[11px]" value={gate.buyUrl} readOnly disabled />
          </Field>
          <Field label="RPC used for the balance read" help="Server-only. Never taken from a browser.">
            <input className="field font-mono text-[11px]" value={gate.rpcUrl} readOnly disabled />
          </Field>
          <label className="flex items-center gap-2 self-end rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-xs text-[#d5d0de]">
            <input type="checkbox" checked={gate.allowAdminBypass} onChange={(event) => setGate((current) => ({ ...current, allowAdminBypass: event.target.checked }))} className="accent-violet-300" />
            Allow admin/owner bypass
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void saveGate()} disabled={gateBusy || !databaseReady} className="focus-ring flex h-11 items-center gap-2 rounded-xl bg-violet-200 px-4 text-sm font-semibold text-[#160f27] disabled:opacity-40">
            <Save size={15} /> {gateBusy ? "Saving…" : "Save access gate"}
          </button>
          <button type="button" onClick={() => setGate(gateInitial)} className="focus-ring flex h-11 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-sm">
            <RotateCcw size={15} /> Reset
          </button>
          {gateNotice && <p role="status" className="text-xs text-violet-200">{gateNotice}</p>}
        </div>
        <p className="mt-3 text-[11px] leading-5 text-[#625d6d]">
          Every change here is written to the admin audit log. Effective values now: gate{" "}
          <span className="text-[#a8a3b3]">{gate.enabled ? "ON" : "OFF"}</span> ({gate.source.enabled}), minimum{" "}
          <span className="text-[#a8a3b3]">{gate.minimumBalance.toLocaleString("en-US")}</span> ({gate.source.minimumBalance}), bypass{" "}
          <span className="text-[#a8a3b3]">{gate.allowAdminBypass ? "ON" : "OFF"}</span> ({gate.source.allowAdminBypass}).
        </p>
      </section>

      <section className="mt-7 rounded-[24px] border border-white/[0.065] bg-[#0e0c15] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-sm font-semibold">Token publication</h2><p className="mt-1 text-xs leading-5 text-[#777180]">LIVE requires a valid EVM address, an enabled chain, and the exact Clank.trade coin URL.</p></div>
          <label className="flex items-center gap-3 text-xs text-[#a8a3b3]">Launch status<select value={value.cpu.launchStatus} onChange={(event) => updateCpu("launchStatus", event.target.value as Cpu["launchStatus"])} className="field !w-auto"><option value="PRELAUNCH">PRELAUNCH</option><option value="LIVE">LIVE</option></select></label>
        </div>
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <Field label="Token name"><input className="field" value={value.cpu.tokenName} onChange={(event) => updateCpu("tokenName", event.target.value)} /></Field>
          <Field label="Ticker"><input className="field" value={value.cpu.ticker} onChange={(event) => updateCpu("ticker", event.target.value)} /></Field>
          <Field label="Contract address" help="Syntax validation does not prove this is a token contract."><input className="field font-mono" placeholder="0x…" value={value.cpu.contractAddress} onChange={(event) => updateCpu("contractAddress", event.target.value)} /></Field>
          <Field label="CPU chain"><select className="field" value={value.cpu.chainId ?? ""} onChange={(event) => updateCpu("chainId", event.target.value ? Number(event.target.value) : null)}><option value="">Not configured</option>{value.chains.filter((chain) => chain.enabled).map((chain) => <option key={chain.id} value={chain.id}>{chain.name || `Chain ${chain.id}`} · {chain.id}</option>)}</select></Field>
          <Field label="Exact Clank.trade coin URL" help="Use the token page, not the generic homepage."><input className="field" type="url" placeholder="https://clank.trade/…" value={value.cpu.clankTradeUrl} onChange={(event) => updateCpu("clankTradeUrl", event.target.value)} /></Field>
          <Field label="Explicit contract explorer URL" help="Optional; otherwise the selected chain explorer is used."><input className="field" type="url" placeholder="https://…/address/0x…" value={value.cpu.explorerUrl} onChange={(event) => updateCpu("explorerUrl", event.target.value)} /></Field>
          <Field label="X URL"><input className="field" type="url" value={value.cpu.xUrl} onChange={(event) => updateCpu("xUrl", event.target.value)} /></Field>
          <Field label="Website URL"><input className="field" type="url" value={value.cpu.websiteUrl} onChange={(event) => updateCpu("websiteUrl", event.target.value)} /></Field>
          <label className="lg:col-span-2"><span className="text-xs font-medium text-[#a8a3b3]">What is CPU?</span><textarea className="field mt-2 h-auto resize-y py-3 leading-6" rows={4} value={value.cpu.description} onChange={(event) => updateCpu("description", event.target.value)} /></label>
        </div>
      </section>

      <section className="mt-5 rounded-[24px] border border-white/[0.065] bg-[#0e0c15] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Supported EVM chains</h2><p className="mt-1 text-xs leading-5 text-[#777180]">Nothing is assumed for Robinhood Chain. Add only verified chain details from an authoritative source.</p></div><button type="button" onClick={() => setValue((current) => ({ ...current, chains: [...current.chains, newChain()] }))} className="focus-ring flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-xs"><Plus size={14} /> Add chain</button></div>
        <div className="mt-5 space-y-4">
          {value.chains.length === 0 && <div className="rounded-2xl border border-dashed border-white/[0.08] p-7 text-center text-sm text-[#777180]">No chain details configured. Wallet authentication can still be used for saved chats.</div>}
          {value.chains.map((chain, index) => <div key={`${chain.id}-${index}`} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4"><div className="flex items-center justify-between gap-3"><label className="flex items-center gap-2 text-xs text-[#a8a3b3]"><input type="checkbox" checked={chain.enabled} onChange={(event) => updateChain(index, { enabled: event.target.checked })} className="accent-violet-300" /> Enabled</label><button type="button" aria-label={`Remove ${chain.name || "chain"}`} onClick={() => setValue((current) => ({ ...current, chains: current.chains.filter((_, itemIndex) => itemIndex !== index), primaryChainId: current.primaryChainId === chain.id ? null : current.primaryChainId, cpu: current.cpu.chainId === chain.id ? { ...current.cpu, chainId: null } : current.cpu }))} className="focus-ring grid h-9 w-9 place-items-center rounded-lg text-[#777180] hover:bg-rose-300/[0.06] hover:text-rose-300"><Trash2 size={15} /></button></div><div className="mt-4 grid gap-4 lg:grid-cols-3"><Field label="Chain ID"><input className="field" type="number" min="1" value={chain.id} onChange={(event) => updateChain(index, { id: Number(event.target.value) })} /></Field><Field label="Chain name"><input className="field" value={chain.name} onChange={(event) => updateChain(index, { name: event.target.value })} /></Field><Field label="Currency name"><input className="field" value={chain.nativeCurrency.name} onChange={(event) => updateCurrency(index, { name: event.target.value })} /></Field><Field label="Currency symbol"><input className="field" value={chain.nativeCurrency.symbol} onChange={(event) => updateCurrency(index, { symbol: event.target.value })} /></Field><Field label="Currency decimals"><input className="field" type="number" min="0" max="36" value={chain.nativeCurrency.decimals} onChange={(event) => updateCurrency(index, { decimals: Number(event.target.value) })} /></Field><Field label="Icon URL"><input className="field" value={chain.iconUrl} onChange={(event) => updateChain(index, { iconUrl: event.target.value })} /></Field><label className="lg:col-span-2"><span className="text-xs font-medium text-[#a8a3b3]">RPC URL</span><input className="field mt-2" type="url" value={chain.rpcUrl} onChange={(event) => updateChain(index, { rpcUrl: event.target.value })} /></label><Field label="Block explorer URL"><input className="field" type="url" value={chain.blockExplorerUrl} onChange={(event) => updateChain(index, { blockExplorerUrl: event.target.value })} /></Field></div></div>)}
        </div>
        <label className="mt-5 block max-w-md"><span className="text-xs font-medium text-[#a8a3b3]">Primary chain</span><select className="field mt-2" value={value.primaryChainId ?? ""} onChange={(event) => setValue((current) => ({ ...current, primaryChainId: event.target.value ? Number(event.target.value) : null }))}><option value="">Not configured</option>{value.chains.filter((chain) => chain.enabled).map((chain) => <option key={chain.id} value={chain.id}>{chain.name || `Chain ${chain.id}`} · {chain.id}</option>)}</select></label>
      </section>

      <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" onClick={() => setValue(initial)} className="focus-ring flex h-11 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-sm"><RotateCcw size={15} /> Reset</button><button disabled={busy || !databaseReady} className="focus-ring flex h-11 items-center gap-2 rounded-xl bg-violet-200 px-4 text-sm font-semibold text-[#160f27] disabled:opacity-40"><Save size={15} /> {busy ? "Saving…" : "Save"}</button>{notice && <p role="status" className="text-xs text-violet-200">{notice}</p>}</div>
    </form>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return <label><span className="text-xs font-medium text-[#a8a3b3]">{label}</span>{help && <span className="ml-2 text-[10px] text-[#625d6d]">{help}</span>}<div className="mt-2">{children}</div></label>;
}
