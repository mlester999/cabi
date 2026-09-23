"use client";

import { BadgeCheck, Check, Copy, Heart, Laugh, Pencil, RotateCcw, Share2, Sparkles, ThumbsUp, Trash2 } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { MiniCabi } from "@/components/cabi/mini-cabi";

export type ChatMessageModel = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "streaming" | "complete" | "failed" | "cancelled";
  createdAt?: string;
  sources?: Array<{ title: string; url: string; fetchedAt?: string }>;
  reaction?: "heart" | "laugh" | "helpful";
};

type Props = {
  message: ChatMessageModel;
  onRetry?: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
  onShare?: () => void;
  onReact?: (reaction: ChatMessageModel["reaction"]) => void;
};

export function ChatMessage({ message, onRetry, onDelete, onEdit, onShare, onReact }: Props) {
  const [copied, setCopied] = useState(false);
  const isCabi = message.role === "assistant";
  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <article className={`group/message flex gap-3 ${isCabi ? "items-start" : "justify-end"}`} aria-label={`${isCabi ? "Cabi" : "You"} said`}>
      {isCabi && <MiniCabi className="mt-1 h-9 w-9 rounded-[13px]" />}
      <div className={`min-w-0 ${isCabi ? "max-w-[min(92%,46rem)]" : "max-w-[82%]"}`}>
        <div className={`relative rounded-[20px] px-4 py-3.5 text-[15px] leading-7 shadow-lg ${isCabi ? "rounded-tl-[7px] border border-violet-300/[0.14] bg-violet-300/[0.055] text-[#ece9f3]" : "rounded-tr-[7px] border border-white/[0.07] bg-[#17141f] text-white"}`}>
          {isCabi ? (
            <div className="cabi-markdown break-words">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={{
                a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener" className="text-violet-300 underline decoration-violet-300/35 underline-offset-4 hover:text-violet-200">{children}</a>,
                code: ({ children, className }) => className ? <code className={`${className} block overflow-x-auto rounded-xl bg-black/35 p-3 font-mono text-[13px] leading-6 text-violet-100`}>{children}</code> : <code className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[13px] text-violet-200">{children}</code>,
                pre: ({ children }) => <pre className="my-3 max-w-full overflow-hidden">{children}</pre>,
                ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
                ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
                p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
              }}>{message.content || (message.status === "streaming" ? "" : "…")}</ReactMarkdown>
              {message.status === "streaming" && <span className="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-full bg-violet-300 align-middle" aria-label="Cabi is typing" />}
            </div>
          ) : <p className="whitespace-pre-wrap break-words">{message.content}</p>}
          {message.status === "failed" && <div className="mt-3 flex items-center gap-2 border-t border-white/[0.06] pt-2.5 text-xs text-rose-300"><span className="flex-1">Looks like my brain needs a second.</span><button onClick={onRetry} className="focus-ring rounded-lg px-2 py-1 hover:bg-white/[0.05]">Try again</button></div>}
        </div>
        {Boolean(message.sources?.length) && <div className="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5"><p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-[#706a7d]"><BadgeCheck size={12} /> Sources</p><div className="flex flex-wrap gap-1.5">{message.sources!.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer noopener" className="max-w-full truncate rounded-lg bg-white/[0.035] px-2 py-1 text-[11px] text-violet-300 hover:bg-violet-300/[0.08]">{source.title || new URL(source.url).hostname}</a>)}</div></div>}
        <div className={`mt-1.5 flex min-h-8 flex-wrap items-center gap-1 opacity-0 transition group-hover/message:opacity-100 group-focus-within/message:opacity-100 ${isCabi ? "justify-start" : "justify-end"}`}>
          {isCabi && <><Action label={copied ? "Copied" : "Copy"} onClick={copy}>{copied ? <Check size={13} /> : <Copy size={13} />}</Action><Action label="Regenerate" onClick={onRetry}><RotateCcw size={13} /></Action><Action label="Share card" onClick={onShare}><Share2 size={13} /></Action><span className="mx-1 h-3 w-px bg-white/[0.08]" /><Reaction label="Heart" active={message.reaction === "heart"} onClick={() => onReact?.("heart")}><Heart size={13} fill={message.reaction === "heart" ? "currentColor" : "none"} /></Reaction><Reaction label="Funny" active={message.reaction === "laugh"} onClick={() => onReact?.("laugh")}><Laugh size={13} /></Reaction><Reaction label="Helpful" active={message.reaction === "helpful"} onClick={() => onReact?.("helpful")}><ThumbsUp size={13} /></Reaction></>}
          {!isCabi && <><Action label={copied ? "Copied" : "Copy"} onClick={copy}>{copied ? <Check size={13} /> : <Copy size={13} />}</Action><Action label="Edit" onClick={onEdit}><Pencil size={13} /></Action><Action label="Delete" onClick={onDelete}><Trash2 size={13} /></Action></>}
          <time className="ml-1 text-[10px] text-[#5f5a67]" dateTime={message.createdAt}>{message.createdAt ? new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Now"}</time>
        </div>
      </div>
    </article>
  );
}

function Action({ label, onClick, children }: { label: string; onClick?: () => void; children: React.ReactNode }) {
  return <button className="focus-ring grid h-8 min-w-8 place-items-center rounded-lg px-2 text-[#706a7d] hover:bg-white/[0.05] hover:text-white" onClick={onClick} aria-label={label} title={label}>{children}</button>;
}
function Reaction({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`focus-ring grid h-8 min-w-8 place-items-center rounded-lg px-2 ${active ? "bg-violet-300/[0.1] text-violet-300" : "text-[#706a7d] hover:bg-white/[0.05] hover:text-white"}`} onClick={onClick} aria-label={label} aria-pressed={active}>{children}</button>;
}

export function CabiThinking() {
  return <div role="status" className="flex items-center gap-3"><MiniCabi className="h-9 w-9" /><div className="flex items-center gap-2 rounded-[18px] rounded-tl-[7px] border border-violet-300/[0.12] bg-violet-300/[0.05] px-4 py-3 text-xs text-[#9f99aa]"><Sparkles size={14} className="animate-pulse text-violet-300" /> Cabi is thinking<span className="flex gap-1"><i className="h-1 w-1 animate-bounce rounded-full bg-violet-300 [animation-delay:-.2s]" /><i className="h-1 w-1 animate-bounce rounded-full bg-violet-300 [animation-delay:-.1s]" /><i className="h-1 w-1 animate-bounce rounded-full bg-violet-300" /></span></div></div>;
}
