"use client";

import { Check, Copy, ExternalLink, Info, ShieldAlert, Sparkles, TrendingUp, Wallet } from "lucide-react";
import { useState } from "react";

import { ImageCardView } from "@/components/chat/image-card";
import type { ActionCard as ActionCardModel } from "@/lib/actions/types";

/**
 * The inline action card.
 *
 * Renders whatever the trusted action layer produced. Three rules are enforced
 * by construction rather than by convention:
 *
 * - External links always open in a new tab with `noopener noreferrer`, and only
 *   ever use a URL that was validated as an absolute HTTPS destination upstream.
 *   No URL is built from user input here.
 * - When a request needs confirmation, the card says so explicitly and offers no
 *   one-click execution path.
 * - Rows come straight from the server. The component never computes a price, a
 *   quote, a fee, or a receive amount.
 */
export function ActionCardView({ card, className = "", onRegenerate, onUseAsAvatar, onRetry }: {
  card: ActionCardModel;
  className?: string;
  onRegenerate?: (prompt: string) => void;
  onUseAsAvatar?: (card: Extract<ActionCardModel, { kind: "IMAGE" }>) => void;
  onRetry?: (prompt: string, parentGenerationId?: string) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1_600);
    } catch {
      setCopied(null);
    }
  };

  const tone = card.tone ?? "neutral";
  const accent =
    tone === "error" ? "border-rose-300/20 bg-rose-300/[0.05]"
    : tone === "caution" ? "border-amber-300/18 bg-amber-300/[0.045]"
    : "border-violet-200/[0.14] bg-violet-300/[0.045]";

  const Icon = card.kind === "TRADE" ? TrendingUp
    : card.kind === "WALLET" || card.kind === "PORTFOLIO" || card.kind === "HOLDING" ? Wallet
    : card.kind === "CLARIFY" ? Info
    : card.kind === "NOTICE" && tone !== "neutral" ? ShieldAlert
    : Sparkles;

  // Only token-shaped cards carry a copyable contract address.
  const copyableAddress = "tokenAddress" in card ? card.tokenAddress : undefined;

  // A generated image is the content, so it gets its own presentation rather
  // than being squeezed into the rows-and-links layout built for token data.
  if (card.kind === "IMAGE") {
    return (
      <div className={className}>
        <ImageCardView card={card} onRegenerate={onRegenerate} onUseAsAvatar={onUseAsAvatar} />
      </div>
    );
  }

  return (
    <section className={`mt-3 w-full max-w-[min(100%,34rem)] overflow-hidden rounded-xl border ${accent} p-4 shadow-[0_10px_30px_rgba(0,0,0,.28)] ${className}`} aria-label={`${card.title} card`}>
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-violet-200/[0.14] bg-black/25 text-[var(--cabi-primary)]">
          <Icon size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13px] font-semibold uppercase tracking-[.12em] text-white">{card.title}</h3>
          {card.subtitle && <p className="mt-1 text-[11px] leading-5 text-[var(--cabi-text-muted)]">{card.subtitle}</p>}
        </div>
        {card.kind === "TRADE" && card.action && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.12em] ${card.action === "SELL" ? "bg-rose-300/[0.12] text-rose-200" : "bg-emerald-300/[0.12] text-emerald-200"}`}>
            {card.action}
          </span>
        )}
      </div>

      {card.rows.length > 0 && (
        <dl className="mt-3 divide-y divide-white/[0.05] rounded-2xl border border-[var(--cabi-hairline)] bg-black/20 px-3">
          {card.rows.map((row) => (
            <div key={`${row.label}-${row.value}`} className="flex items-start justify-between gap-3 py-2">
              <dt className="shrink-0 text-[11px] uppercase tracking-[.1em] text-[var(--cabi-text-muted)]">{row.label}</dt>
              <dd className={`min-w-0 break-all text-right text-[12px] ${row.mono ? "font-mono" : ""} ${row.muted ? "text-[var(--cabi-text-muted)]" : "text-[var(--cabi-text-secondary)]"}`}>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {card.options && card.options.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {card.options.map((option) => (
            <li key={option.id} className="rounded-xl border border-[var(--cabi-hairline)] bg-black/20 px-3 py-2">
              <p className="text-[12px] font-medium text-white">{option.label}</p>
              {option.detail && <p className="mt-0.5 text-[11px] text-[var(--cabi-text-muted)]">{option.detail}</p>}
              {option.address && <p className="mt-0.5 break-all font-mono text-[10px] text-[var(--cabi-text-muted)]">{option.address}</p>}
            </li>
          ))}
        </ul>
      )}

      {card.message && <p className="mt-3 text-[11px] leading-5 text-[var(--cabi-text-secondary)]">{card.message}</p>}

      {card.debugDetails && (
        <details className="mt-3 rounded-lg border border-violet-200/[0.12] bg-black/20 px-2.5 py-2 text-[10px] text-[var(--cabi-text-muted)]">
          <summary className="cabi-focus cursor-pointer text-[10px] font-semibold text-[var(--cabi-text-secondary)]">Owner preview details</summary>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
            <div><dt className="uppercase tracking-[.08em] text-white/35">Request</dt><dd className="break-all font-mono">{card.debugDetails.requestId}</dd></div>
            <div><dt className="uppercase tracking-[.08em] text-white/35">Stage</dt><dd>{card.debugDetails.stage ?? card.debugDetails.lastStage ?? "—"}</dd></div>
            <div><dt className="uppercase tracking-[.08em] text-white/35">Category</dt><dd>{card.debugDetails.providerErrorCategory ?? "—"}</dd></div>
            <div><dt className="uppercase tracking-[.08em] text-white/35">HTTP</dt><dd>{card.debugDetails.httpStatus ?? "—"}</dd></div>
            <div><dt className="uppercase tracking-[.08em] text-white/35">Provider</dt><dd>{card.debugDetails.provider ?? "—"}</dd></div>
            <div><dt className="uppercase tracking-[.08em] text-white/35">Model</dt><dd className="break-all">{card.debugDetails.model ?? "—"}</dd></div>
            <div><dt className="uppercase tracking-[.08em] text-white/35">Reference</dt><dd>{card.debugDetails.referenceAttached ? `v${card.debugDetails.referenceVersion ?? "?"} attached` : "text only"}</dd></div>
            <div><dt className="uppercase tracking-[.08em] text-white/35">Size</dt><dd>{card.debugDetails.width && card.debugDetails.height ? `${card.debugDetails.width}×${card.debugDetails.height}` : "—"}</dd></div>
            <div><dt className="uppercase tracking-[.08em] text-white/35">Fetched</dt><dd>{card.debugDetails.byteLength ? `${card.debugDetails.byteLength} bytes${card.debugDetails.contentType ? ` · ${card.debugDetails.contentType}` : ""}` : "—"}</dd></div>
            <div><dt className="uppercase tracking-[.08em] text-white/35">Latency</dt><dd>{card.debugDetails.latencyMs} ms</dd></div>
            <div><dt className="uppercase tracking-[.08em] text-white/35">Prompt hash</dt><dd className="break-all font-mono">{card.debugDetails.promptHash ?? "—"}</dd></div>
            <div><dt className="uppercase tracking-[.08em] text-white/35">Prompt length</dt><dd>{card.debugDetails.promptLength ?? "—"}</dd></div>
            <div><dt className="uppercase tracking-[.08em] text-white/35">Retry count</dt><dd>{card.debugDetails.retryCount}</dd></div>
            <div><dt className="uppercase tracking-[.08em] text-white/35">Scene</dt><dd className="break-words">{card.debugDetails.scene ?? "—"}</dd></div>
            <div><dt className="uppercase tracking-[.08em] text-white/35">Expression</dt><dd>{card.debugDetails.expression ?? "—"}</dd></div>
            <div><dt className="uppercase tracking-[.08em] text-white/35">Outfit</dt><dd>{card.debugDetails.outfit ?? "—"}</dd></div>
          </dl>
          <ol className="mt-2 space-y-0.5 border-t border-white/[0.06] pt-2">
            {card.debugDetails.events.map((event, index) => (
              <li key={`${event.stage}-${index}`} className="flex items-center justify-between gap-2">
                <span className={event.error ? "text-rose-200" : ""}>{event.stage}{event.error ? ` · ${event.error}` : ""}</span>
                <span className="shrink-0 tabular-nums text-white/35">{event.latencyMs} ms{event.httpStatus ? ` · ${event.httpStatus}` : ""}</span>
              </li>
            ))}
          </ol>
        </details>
      )}

      {(card.links.length > 0 || copyableAddress) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {copyableAddress && (
            <button
              type="button"
              onClick={() => void copy("contract", copyableAddress)}
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-2)] px-3 text-[11px] font-semibold text-[var(--cabi-text-secondary)] transition hover:bg-[var(--cabi-surface-3)]"
            >
              {copied === "contract" ? <Check size={13} className="text-emerald-300" /> : <Copy size={13} />}
              {copied === "contract" ? "Copied" : "Copy contract"}
            </button>
          )}
          {card.links.map((link) => (
            link.kind === "INTERNAL" ? (
              <a key={link.url} href={link.url} className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-2)] px-3 text-[11px] font-semibold text-[var(--cabi-text-secondary)] transition hover:bg-[var(--cabi-surface-3)]">
                {link.label}
              </a>
            ) : (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`focus-ring inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[11px] font-semibold transition ${link.kind === "CLANK_TRADE" ? "bg-[var(--cabi-primary)] text-[var(--cabi-on-primary)] hover:brightness-105" : "border border-[var(--cabi-hairline)] bg-[var(--cabi-surface-2)] text-[var(--cabi-text-secondary)] hover:bg-[var(--cabi-surface-3)]"}`}
              >
                {link.label} <ExternalLink size={12} aria-hidden="true" />
              </a>
            )
          ))}
        </div>
      )}

      {card.retry && onRetry && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => onRetry(card.retry!.prompt, card.retry!.parentGenerationId)}
            className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--cabi-primary)] px-3 text-[11px] font-semibold text-[var(--cabi-on-primary)] transition hover:brightness-105"
          >
            {card.retry.label}
          </button>
        </div>
      )}

      {card.requiresConfirmation && (
        <p className="mt-3 flex items-start gap-2 text-[10px] leading-4 text-[var(--cabi-text-muted)]">
          <ShieldAlert size={12} className="mt-0.5 shrink-0 text-amber-200/80" aria-hidden="true" />
          Nothing happens until you confirm it yourself. Cabi never signs, approves, or sends anything on her own.
        </p>
      )}
    </section>
  );
}
