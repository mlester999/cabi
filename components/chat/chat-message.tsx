"use client";

import { BadgeCheck, Check, Copy, Heart, Laugh, Pencil, RotateCcw, Share2, ThumbsUp, Trash2 } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { ActionCardView } from "@/components/chat/action-card";
import { MiniCabi } from "@/components/cabi/mini-cabi";
import { CabiActivityStatus } from "@/components/cabi/cabi-activity-status";
import { cabiFailureMessages, cabiRetryLabel, type CabiStatusOverrides } from "@/lib/cabi/status-messages";
import type { ActionCard } from "@/lib/actions/types";

export type ChatMessageModel = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "streaming" | "complete" | "failed" | "cancelled";
  createdAt?: string;
  sources?: Array<{ title: string; url: string; fetchedAt?: string }>;
  reaction?: "heart" | "laugh" | "helpful";
  /** Produced by the trusted action layer; validated before it reaches here. */
  actionCard?: ActionCard;
};

type Props = {
  message: ChatMessageModel;
  onRetry?: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
  onShare?: () => void;
  onReact?: (reaction: ChatMessageModel["reaction"]) => void;
  /** Re-asks for an image with the same prompt. Subject to the normal quota. */
  onRegenerateImage?: (prompt: string) => void;
  /** Retries a persisted card request and keeps its generation lineage. */
  onRetryPrompt?: (prompt: string, parentGenerationId?: string) => void;
  onUseImageAsAvatar?: (card: Extract<ActionCard, { kind: "IMAGE" }>) => Promise<boolean>;
  /** Owner-added chat-thinking copy, resolved from the server-side status settings. */
  statusMessages?: CabiStatusOverrides | null;
};

/**
 * One message in the transcript.
 *
 * The two bubbles are deliberately a matched pair rather than two designs: same
 * padding, same type, same max width, and one 6px "tail" corner on the side each
 * one is aligned to. The only differences are what they should be — alignment,
 * and Cabi's soft lavender tint against the user's neutral elevated surface.
 *
 * Image generation failures arrive as a normal Cabi reply with a retry action;
 * failed text replies keep their compact shared failure line and retry button.
 */
export function ChatMessage({ message, onRetry, onDelete, onEdit, onShare, onReact, onRegenerateImage, onRetryPrompt, onUseImageAsAvatar, statusMessages }: Props) {
  const [copied, setCopied] = useState(false);
  const isCabi = message.role === "assistant";
  const hasCardRetry = Boolean(message.actionCard?.retry);
  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  // A card-only reply has no text bubble: the card IS the message.
  const showBubble = !(isCabi && !message.content.trim() && message.actionCard);

  return (
    <article className={`group/message flex gap-3 ${isCabi ? "items-start" : "justify-end"}`} aria-label={`${isCabi ? "Cabi" : "You"} said`}>
      {isCabi ? <MiniCabi className="mt-1 h-8 w-8 rounded-lg" /> : null}

      <div className={`min-w-0 ${isCabi ? "max-w-[min(82%,46rem)]" : "max-w-[min(72%,36rem)]"}`}>
        {showBubble ? (
          <div
            className={`relative rounded-xl px-4 py-3 text-[15px] leading-7 ${
              isCabi
                ? "rounded-tl-sm bg-violet-300/[0.06] text-[#ece9f3]"
                : "rounded-tr-sm border border-white/[0.055] bg-[#17141f] text-white"
            }`}
          >
            {isCabi ? (
              <div className="cabi-markdown break-words">
                {message.content.trim() ? (
                  <>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeSanitize]}
                      components={{
                        a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener" className="cabi-focus rounded text-violet-300 underline decoration-violet-300/35 underline-offset-4 hover:text-violet-200">{children}</a>,
                        code: ({ children, className }) => className
                          ? <code className={`${className} block overflow-x-auto rounded-lg bg-black/35 p-3 font-mono text-[13px] leading-6 text-violet-100`}>{children}</code>
                          : <code className="rounded-sm bg-white/[0.07] px-1.5 py-0.5 font-mono text-[13px] text-violet-200">{children}</code>,
                        pre: ({ children }) => <pre className="my-3 max-w-full overflow-hidden">{children}</pre>,
                        ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
                        ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
                        p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                    {message.status === "streaming" ? (
                      <span className="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-full bg-violet-300 align-middle" aria-label="Cabi is typing" />
                    ) : null}
                  </>
                ) : message.status === "streaming" ? (
                  <CabiActivityStatus type="CHAT_THINKING" overrides={statusMessages} />
                ) : (
                  <span>…</span>
                )}
              </div>
            ) : (
              <p className="whitespace-pre-wrap break-words">{message.content}</p>
            )}
          </div>
        ) : null}

        {/* The single error surface for a failed reply. No provider text. */}
        {message.status === "failed" && message.content.trim() ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-rose-300/[0.05] px-3 py-2.5">
            <span className="flex-1 text-xs text-rose-200">{cabiFailureMessages.CHAT}</span>
            <button onClick={onRetry} className="cabi-focus rounded-lg px-2.5 py-1.5 text-xs font-semibold text-violet-200 hover:bg-white/[0.05]">{cabiRetryLabel}</button>
          </div>
        ) : null}

        {message.sources?.length ? (
          <div className="mt-2 rounded-lg border border-white/[0.05] bg-white/[0.02] p-2.5">
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-[#706a7d]"><BadgeCheck size={12} aria-hidden="true" /> Sources</p>
            <div className="flex flex-wrap gap-1.5">
              {message.sources.map((source) => (
                <a key={source.url} href={source.url} target="_blank" rel="noreferrer noopener" className="cabi-focus max-w-full truncate rounded-lg bg-white/[0.035] px-2 py-1 text-[11px] text-violet-300 transition-colors hover:bg-violet-300/[0.08]">
                  {source.title || new URL(source.url).hostname}
                </a>
              ))}
            </div>
          </div>
        ) : null}

        {message.actionCard ? <ActionCardView card={message.actionCard} onRegenerate={onRegenerateImage} onRetry={onRetryPrompt} onUseAsAvatar={onUseImageAsAvatar} /> : null}

        <div className={`mt-1.5 flex min-h-8 flex-wrap items-center gap-1 transition-opacity duration-200 ${isCabi ? "justify-start" : "justify-end"} opacity-100 md:opacity-0 md:group-hover/message:opacity-100 md:group-focus-within/message:opacity-100`}>
          {isCabi && !hasCardRetry ? (
            <>
              <MessageAction label={copied ? "Copied" : "Copy"} onClick={copy}>{copied ? <Check size={13} /> : <Copy size={13} />}</MessageAction>
              <MessageAction label="Regenerate" onClick={onRetry}><RotateCcw size={13} /></MessageAction>
              <MessageAction label="Share card" onClick={onShare}><Share2 size={13} /></MessageAction>
              <span aria-hidden="true" className="mx-1 h-3 w-px bg-white/[0.08]" />
              <MessageAction label="Heart" active={message.reaction === "heart"} onClick={() => onReact?.("heart")}><Heart size={13} fill={message.reaction === "heart" ? "currentColor" : "none"} /></MessageAction>
              <MessageAction label="Funny" active={message.reaction === "laugh"} onClick={() => onReact?.("laugh")}><Laugh size={13} /></MessageAction>
              <MessageAction label="Helpful" active={message.reaction === "helpful"} onClick={() => onReact?.("helpful")}><ThumbsUp size={13} /></MessageAction>
            </>
          ) : null}
          {!isCabi ? (
            <>
              <MessageAction label={copied ? "Copied" : "Copy"} onClick={copy}>{copied ? <Check size={13} /> : <Copy size={13} />}</MessageAction>
              <MessageAction label="Edit" onClick={onEdit}><Pencil size={13} /></MessageAction>
              <MessageAction label="Delete" onClick={onDelete}><Trash2 size={13} /></MessageAction>
            </>
          ) : null}
          <time className="ml-1 text-[10px] text-[#5f5a67]" dateTime={message.createdAt}>
            {message.createdAt ? new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Now"}
          </time>
        </div>
      </div>
    </article>
  );
}

/** A message-level icon action. One size and one hover treatment, always. */
function MessageAction({ label, active = false, onClick, children }: { label: string; active?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={`cabi-focus grid h-8 min-w-8 place-items-center rounded-lg px-2 transition-colors ${
        active
          ? "bg-violet-300/[0.1] text-violet-300"
          : "text-[#706a7d] hover:bg-white/[0.05] hover:text-white"
      }`}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active || undefined}
      title={label}
    >
      {children}
    </button>
  );
}

/**
 * Kept as a named export for callers that render the thinking line on its own.
 *
 * It now delegates to the shared `CabiActivityStatus`, so there is ONE thinking
 * implementation across the app instead of this file carrying its own loader copy.
 */
export function CabiThinking({ overrides }: { overrides?: CabiStatusOverrides | null } = {}) {
  return <CabiActivityStatus type="CHAT_THINKING" overrides={overrides} />;
}
