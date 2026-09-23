"use client";

import { MiniCabi } from "@/components/cabi/mini-cabi";
import { ChatMessage, type ChatMessageModel } from "@/components/chat/chat-message";
import { CpuTokenCard } from "@/components/cpu/cpu-token-card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WalletButton } from "@/components/wallet/wallet-button";
import { useWallet } from "@/components/wallet/wallet-provider";
import { readEventStream } from "@/lib/client/sse";
import { shouldImportGuestChat } from "@/lib/wallet/persistence";
import {
  ArrowUp,
  Check,
  ChevronLeft,
  Clock3,
  Download,
  Heart,
  Lock,
  Menu,
  MessageCircleMore,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Sparkles,
  Square,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type ConversationGroup = "Today" | "Yesterday" | "Previous 7 Days" | "Older";
type Conversation = { id: string; title: string; pinned: boolean; updated_at: string; group?: ConversationGroup };
type Bond = { level: number; label: string; progress: number; points: number };
type StreamPayload = {
  text?: string;
  message?: string;
  assistantMessageId?: string;
  conversationId?: string;
  persistent?: boolean;
  sources?: ChatMessageModel["sources"];
  bond?: Bond;
};

const quickPrompts = ["Tell me something random", "What is Clank.trade?", "How are you today?", "Remember something about me"];
const groupOrder = ["Pinned", "Today", "Yesterday", "Previous 7 Days", "Older"] as const;

function PresenceArt({ mood, speaking = false, authenticated, bond }: { mood: string; speaking?: boolean; authenticated: boolean; bond: Bond | null }) {
  const [failed, setFailed] = useState(false);
  const progress = authenticated ? (bond?.progress ?? 0) : 0;
  return (
    <div className="relative flex min-h-0 flex-1 items-end justify-center overflow-hidden rounded-[28px] border border-white/[0.055] bg-[#0b0912]">
      <div className={`absolute left-1/2 top-[43%] h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/[0.15] blur-[75px] transition duration-700 ${speaking ? "scale-110 opacity-100" : "scale-100 opacity-70"}`} />
      <div className="cabi-orbit absolute left-1/2 top-[42%] h-[330px] w-[330px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-violet-300/[0.14]" />
      <div className="absolute left-1/2 top-[42%] h-[250px] w-[250px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-violet-300/[0.10] shadow-[0_0_80px_rgba(167,139,250,.1)]" />
      <span className="absolute left-8 top-8 h-1.5 w-1.5 rounded-full bg-violet-200/70 shadow-[42px_80px_0_rgba(196,181,253,.36),250px_42px_0_rgba(196,181,253,.4),215px_190px_0_rgba(196,181,253,.25)]" />
      {!failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/assets/cabi-main.png" alt="Cabi wearing her purple CPU shirt" className={`cabi-breathe relative z-10 max-h-[91%] w-full object-contain object-bottom drop-shadow-[0_28px_45px_rgba(0,0,0,.55)] ${speaking ? "brightness-110" : ""}`} onError={() => setFailed(true)} />
      ) : (
        <div className="cabi-breathe relative z-10 mb-24 grid h-64 w-64 place-items-center rounded-full border border-violet-200/10 bg-gradient-to-b from-violet-300/10 to-transparent text-center shadow-[0_0_100px_rgba(139,92,246,.12)]">
          <div><div className="text-5xl font-black tracking-[-0.12em] text-violet-100">CABI</div><div className="mt-2 text-xs font-semibold uppercase tracking-[0.34em] text-violet-300/60">Cat Partner Unit</div></div>
        </div>
      )}
      <div className="absolute inset-x-4 bottom-4 z-20 rounded-[22px] border border-white/[0.08] bg-[#0c0914]/80 p-4 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div><div className="flex items-center gap-2 text-sm font-semibold"><span>Cabi</span><span className="rounded-full bg-violet-300/10 px-2 py-0.5 text-[10px] tracking-[.16em] text-violet-200">CPU</span></div><p className="mt-1 text-xs text-[#8e889b]">{authenticated ? (bond ? `${bond.label} · ${bond.progress}%` : "Bond saved with wallet") : "Temporary guest chat"}</p></div>
          <div className="text-right"><p className="text-xs text-[#706a7d]">Mood</p><p className="text-sm capitalize text-violet-100">{mood}</p></div>
        </div>
        {authenticated && <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-gradient-to-r from-violet-300 via-violet-400 to-violet-500 shadow-[0_0_14px_rgba(167,139,250,.8)] transition-[width]" style={{ width: `${progress}%` }} /></div>}
      </div>
    </div>
  );
}

function downloadShareCard(text: string, wide: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = wide ? 1600 : 1080;
  canvas.height = wide ? 900 : 1080;
  const context = canvas.getContext("2d");
  if (!context) return;
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#07070d");
  gradient.addColorStop(.62, "#120d20");
  gradient.addColorStop(1, "#251442");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(196,181,253,.2)";
  context.lineWidth = 2;
  context.strokeRect(44, 44, canvas.width - 88, canvas.height - 88);
  context.fillStyle = "#c4b5fd";
  context.font = `700 ${wide ? 30 : 28}px system-ui`;
  context.fillText("CABI  ·  CAT PARTNER UNIT", 100, 125);
  context.fillStyle = "#ffffff";
  context.font = `600 ${wide ? 54 : 48}px system-ui`;
  const maxWidth = canvas.width - 200;
  const words = text.slice(0, 650).split(/\s+/u);
  let line = "";
  const lines: string[] = [];
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width > maxWidth && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  const lineHeight = wide ? 74 : 66;
  const startY = (canvas.height - lines.length * lineHeight) / 2;
  lines.slice(0, wide ? 7 : 10).forEach((value, index) => context.fillText(value, 100, startY + index * lineHeight));
  context.fillStyle = "#a8a3b3";
  context.font = `500 ${wide ? 28 : 25}px system-ui`;
  context.fillText("— Cabi", 100, canvas.height - 112);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cabi-card-${wide ? "16x9" : "square"}.png`;
    link.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

export function CabiExperience() {
  const wallet = useWallet();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  // Stay temporary until wallet-session discovery finishes. This prevents a
  // chat started during hydration from being persisted merely because an old
  // signed session appears a moment later.
  const [temporaryChat, setTemporaryChat] = useState(true);
  const [messages, setMessages] = useState<ChatMessageModel[]>([]);
  const [composer, setComposer] = useState("");
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("here with you");
  const [notice, setNotice] = useState<string>();
  const [onboardingName, setOnboardingName] = useState(false);
  const [shareMessage, setShareMessage] = useState<ChatMessageModel>();
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const [savingGuestChat, setSavingGuestChat] = useState(false);
  const [bond, setBond] = useState<Bond | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const previousAuthRef = useRef(false);
  const promptedGuestImportRef = useRef(false);

  const refreshConversations = useCallback(async (query = "") => {
    if (!wallet.authenticated) { setConversations([]); return; }
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    params.set("tz", Intl.DateTimeFormat().resolvedOptions().timeZone);
    const response = await fetch(`/api/conversations?${params.toString()}`, { cache: "no-store" });
    if (response.ok) setConversations(((await response.json()) as { conversations: Conversation[] }).conversations);
    else if (response.status === 401) setConversations([]);
  }, [wallet.authenticated]);

  const newChat = useCallback(() => {
    controllerRef.current?.abort();
    setConversationId(undefined);
    setTemporaryChat(!(wallet.sessionLoaded && wallet.authenticated));
    setMessages([]);
    setComposer("");
    setNotice(undefined);
    setOnboardingName(false);
    setSavePromptOpen(false);
    promptedGuestImportRef.current = false;
    setSidebarOpen(false);
    window.setTimeout(() => composerRef.current?.focus(), 20);
  }, [wallet.authenticated, wallet.sessionLoaded]);

  const openConversation = async (id: string) => {
    if (!wallet.authenticated) { wallet.openConnect(); return; }
    const response = await fetch(`/api/conversations/${id}`, { cache: "no-store" });
    if (!response.ok) { setNotice("That chat couldn't be opened."); return; }
    const payload = await response.json() as { conversation: Conversation; messages: Array<{ id: string; role: "user" | "assistant"; content: string; status: ChatMessageModel["status"]; metadata_json?: { sources?: ChatMessageModel["sources"] }; created_at: string }> };
    setConversationId(payload.conversation.id);
    setTemporaryChat(false);
    setMessages(payload.messages.filter((message) => message.role === "user" || message.role === "assistant").map((message) => ({ id: message.id, role: message.role, content: message.content, status: message.status, sources: message.metadata_json?.sources, createdAt: message.created_at })));
    setSidebarOpen(false);
  };

  useEffect(() => {
    if (!wallet.sessionLoaded) return;
    const timer = window.setTimeout(() => {
      if (wallet.authenticated) void refreshConversations();
      else {
        setConversations([]);
        if (previousAuthRef.current) {
          setConversationId(undefined);
          setTemporaryChat(true);
          setMessages([]);
          setBond(null);
          promptedGuestImportRef.current = false;
          setNotice("Wallet disconnected. New messages are temporary.");
        }
      }
      previousAuthRef.current = wallet.authenticated;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshConversations, wallet.authenticated, wallet.sessionLoaded]);

  useEffect(() => {
    if (!wallet.sessionLoaded || !wallet.authenticated) return;
    const hasTranscript = messages.some((message) => message.content.trim());
    if (hasTranscript && temporaryChat) {
      if (promptedGuestImportRef.current) return;
      promptedGuestImportRef.current = true;
      const timer = window.setTimeout(() => setSavePromptOpen(true), 0);
      return () => window.clearTimeout(timer);
    }
    if (hasTranscript || !temporaryChat) return;
    const timer = window.setTimeout(() => setTemporaryChat(false), 0);
    return () => window.clearTimeout(timer);
  }, [messages, temporaryChat, wallet.authenticated, wallet.sessionLoaded]);

  useEffect(() => {
    if (!wallet.authenticated) return;
    const timer = window.setTimeout(() => void refreshConversations(search), 250);
    return () => window.clearTimeout(timer);
  }, [refreshConversations, search, wallet.authenticated]);

  useEffect(() => {
    if (!sending || messages.at(-1)?.status !== "streaming") return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  const send = async (messageText: string, retryOfMessageId?: string) => {
    const text = messageText.trim();
    if (!text || sending) return;
    const persistent = wallet.sessionLoaded && wallet.authenticated && !temporaryChat;
    const requestId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    if (!retryOfMessageId) setMessages((current) => [...current, { id: userId, role: "user", content: text, status: "complete", createdAt: new Date().toISOString() }, { id: assistantId, role: "assistant", content: "", status: "streaming", createdAt: new Date().toISOString() }]);
    else setMessages((current) => [...current, { id: assistantId, role: "assistant", content: "", status: "streaming", createdAt: new Date().toISOString() }]);
    const guestHistory = persistent ? undefined : messages
      .filter((message) => (message.role === "user" || message.role === "assistant") && message.content.trim())
      .slice(-24)
      .map((message) => ({ role: message.role, content: message.content.slice(0, 50_000) }));
    setComposer("");
    setSending(true);
    setStatus("thinking...");
    setNotice(undefined);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: persistent ? conversationId : undefined,
          message: text,
          clientRequestId: requestId,
          retryOfMessageId: persistent ? retryOfMessageId : undefined,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          chainId: wallet.chainId,
          onboardingName: onboardingName && !conversationId,
          guestHistory,
          persist: persistent,
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({ error: "Looks like my brain needs a second." })) as { error?: string };
        throw new Error(payload.error);
      }
      for await (const item of readEventStream(response.body)) {
        const data = item.data as StreamPayload;
        if (item.event === "meta") {
          if (data.persistent && data.conversationId) setConversationId(data.conversationId);
          if (persistent && data.persistent === false) {
            setConversationId(undefined);
            setTemporaryChat(true);
            setNotice("Your wallet session ended. This reply is staying temporary until you sign in again.");
          }
          if (data.assistantMessageId) setMessages((current) => current.map((entry) => entry.id === assistantId ? { ...entry, id: data.assistantMessageId!, sources: data.sources } : entry));
        }
        if (item.event === "delta" && data.text) setMessages((current) => current.map((entry) => (entry.id === assistantId || entry.id === data.assistantMessageId) && entry.role === "assistant" && entry.status === "streaming" ? { ...entry, content: entry.content + data.text } : entry));
        if (item.event === "done") {
          setMessages((current) => current.map((entry) => entry.role === "assistant" && entry.status === "streaming" ? { ...entry, status: "complete", sources: data.sources ?? entry.sources } : entry));
          if (data.bond && persistent) setBond(data.bond);
        }
        if (item.event === "error") throw new Error(data.message ?? "Looks like my brain needs a second.");
      }
      if (persistent) await refreshConversations();
      setStatus("here with you");
      setOnboardingName(false);
    } catch (error) {
      if (controller.signal.aborted) setMessages((current) => current.map((entry) => entry.role === "assistant" && entry.status === "streaming" ? { ...entry, status: "cancelled", content: entry.content || "Stopped." } : entry));
      else {
        const message = error instanceof Error ? error.message : "Looks like my brain needs a second.";
        setMessages((current) => current.map((entry) => entry.role === "assistant" && entry.status === "streaming" ? { ...entry, status: "failed", content: entry.content } : entry));
        setNotice(message);
      }
      setStatus("ready to chat");
    } finally {
      setSending(false);
      controllerRef.current = null;
    }
  };

  const saveGuestChat = async () => {
    if (!shouldImportGuestChat("save")) return;
    const transcript = messages
      .filter((message) => (message.role === "user" || message.role === "assistant") && message.content.trim() && message.status !== "streaming")
      .map((message) => ({ role: message.role, content: message.content, metadata: message.sources?.length ? { sources: message.sources } : undefined }));
    if (!transcript.length || sending) return;
    setSavingGuestChat(true);
    const response = await fetch("/api/conversations/import-guest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: transcript }),
    });
    const payload = await response.json().catch(() => ({})) as { conversation?: Conversation; error?: string };
    setSavingGuestChat(false);
    if (!response.ok || !payload.conversation) { setNotice(payload.error ?? "Cabi couldn't save that temporary chat."); return; }
    setConversationId(payload.conversation.id);
    setTemporaryChat(false);
    setSavePromptOpen(false);
    setNotice("Chat saved to your wallet profile.");
    await refreshConversations();
  };

  const updateConversation = async (conversation: Conversation, patch: { title?: string; pinned?: boolean }) => {
    const response = await fetch(`/api/conversations/${conversation.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    if (!response.ok) { setNotice("That chat couldn't be updated."); return; }
    await refreshConversations(search);
  };

  const renameConversation = async (conversation: Conversation) => {
    const title = window.prompt("Rename chat", conversation.title)?.trim();
    if (title && title !== conversation.title) await updateConversation(conversation, { title });
  };

  const deleteConversation = async (conversation: Conversation) => {
    if (!window.confirm(`Delete “${conversation.title}”? This cannot be undone.`)) return;
    const response = await fetch(`/api/conversations/${conversation.id}`, { method: "DELETE" });
    if (!response.ok) { setNotice("That chat couldn't be deleted."); return; }
    if (conversationId === conversation.id) newChat();
    await refreshConversations(search);
  };

  const submit = (event?: FormEvent) => { event?.preventDefault(); void send(composer); };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } };
  const beginOnboarding = () => { if (!messages.length) { setMessages([{ id: "cabi-intro", role: "assistant", content: "Hey. What should I call you?", status: "complete", createdAt: new Date().toISOString() }]); setOnboardingName(true); } window.setTimeout(() => composerRef.current?.focus(), 20); };
  const retry = (index: number) => { const preceding = [...messages.slice(0, index)].reverse().find((entry) => entry.role === "user"); if (preceding) void send(preceding.content, messages[index].id); };
  const deleteMessage = async (message: ChatMessageModel) => { if (wallet.authenticated && conversationId && !temporaryChat) { const response = await fetch(`/api/messages/${message.id}`, { method: "DELETE" }); if (!response.ok) { setNotice("That message couldn't be deleted."); return; } } setMessages((current) => current.filter((entry) => entry.id !== message.id)); };
  const editMessage = async (message: ChatMessageModel) => { const next = window.prompt("Edit your message", message.content)?.trim(); if (!next || next === message.content) return; if (wallet.authenticated && conversationId && !temporaryChat) { const response = await fetch(`/api/messages/${message.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: next }) }); if (!response.ok) { setNotice("That message couldn't be edited."); return; } } setMessages((current) => current.map((entry) => entry.id === message.id ? { ...entry, content: next } : entry)); };
  const reactToMessage = async (message: ChatMessageModel, reaction: ChatMessageModel["reaction"]) => { const next = message.reaction === reaction ? undefined : reaction; setMessages((current) => current.map((entry) => entry.id === message.id ? { ...entry, reaction: next } : entry)); if (wallet.authenticated && conversationId && !temporaryChat) await fetch(`/api/messages/${message.id}/reaction`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reaction: next ?? "none" }) }); };

  const grouped = useMemo(() => conversations.reduce<Record<string, Conversation[]>>((groups, conversation) => {
    const group = conversation.pinned ? "Pinned" : (conversation.group ?? "Older");
    (groups[group] ??= []).push(conversation);
    return groups;
  }, {}), [conversations]);
  const hasMessages = messages.length > 0;

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await context.registerTool({ name: "send_message_to_cabi", title: "Message Cabi", description: "Send one message to Cabi and wait for her streamed response to finish in the visible chat.", inputSchema: { type: "object", properties: { message: { type: "string", minLength: 1, maxLength: 12000 } }, required: ["message"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async (input) => { const value = input as { message?: unknown }; if (typeof value.message !== "string" || !value.message.trim()) throw new Error("A non-empty message is required."); if (sending) throw new Error("Cabi is already replying."); await send(value.message); return { accepted: true, conversationId: conversationId ?? null, persistent: wallet.authenticated && !temporaryChat }; } }, { signal: lifecycle.signal });
      await context.registerTool({ name: "start_new_cabi_chat", title: "Start a new Cabi chat", description: "Clear the visible conversation workspace and start a new chat with Cabi.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: () => { newChat(); return { started: true }; } }, { signal: lifecycle.signal });
    };
    void register().catch(() => undefined);
    return () => lifecycle.abort();
    // Re-register only when the active chat or generation state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, sending, temporaryChat, wallet.authenticated]);

  return (
    <main className="cabi-noise h-[100dvh] min-h-[620px] overflow-hidden bg-transparent text-white">
      <a href="#cabi-chat" className="focus-ring fixed left-3 top-3 z-[100] -translate-y-24 rounded-xl bg-violet-200 px-4 py-2 text-sm font-semibold text-[#160f27] focus:translate-y-0">Skip to chat</a>
      <div className="grid h-full grid-cols-[256px_minmax(420px,1fr)_360px] max-xl:grid-cols-[232px_minmax(420px,1fr)_320px] max-lg:grid-cols-[232px_minmax(0,1fr)] max-md:grid-cols-1">
        <aside className={`${sidebarOpen ? "translate-x-0" : "max-md:-translate-x-full"} z-50 flex min-h-0 flex-col border-r border-white/[0.065] bg-[#09080f]/95 p-3 transition-transform duration-300 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:w-[min(86vw,312px)] max-md:shadow-2xl`} aria-label="Conversation navigation">
          <div className="flex h-14 items-center gap-3 px-2"><MiniCabi className="h-9 w-9" /><div className="min-w-0 flex-1"><p className="text-[15px] font-bold tracking-[.1em]">CABI</p><p className="text-[10px] uppercase tracking-[.21em] text-[#706a7d]">Cat Partner Unit</p></div><button onClick={() => setSidebarOpen(false)} className="focus-ring hidden h-10 w-10 place-items-center rounded-xl text-[#8e889b] hover:bg-white/[0.05] max-md:grid" aria-label="Close menu"><ChevronLeft size={20} /></button></div>
          <button onClick={newChat} className="focus-ring mt-3 flex h-11 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#c4b5fd] to-[#a78bfa] text-sm font-semibold text-[#160f27] shadow-[0_12px_34px_rgba(139,92,246,.18)] hover:brightness-105"><Plus size={17} strokeWidth={2.4} /> New chat</button>

          {wallet.authenticated ? <>
            <label className="mt-4 flex h-10 items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 text-[#706a7d] focus-within:border-violet-300/25"><Search size={15} /><span className="sr-only">Search conversations</span><input value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#706a7d]" placeholder="Search chats" /></label>
            <div className="scrollbar-cabi mt-5 min-h-0 flex-1 overflow-y-auto">
              {conversations.length === 0 ? <div className="px-3 py-8 text-center"><MiniCabi className="mx-auto h-10 w-10 opacity-60" decorative /><p className="mt-3 text-xs leading-5 text-[#706a7d]">{search ? "No chats match that search." : "No saved chats yet."}</p></div> : groupOrder.map((label) => grouped[label]?.length ? <div key={label} className="mb-5"><div className="mb-2 flex items-center justify-between px-2 text-[11px] font-semibold uppercase tracking-[.14em] text-[#625d6d]"><span>{label}</span>{label === "Pinned" ? <Pin size={12} /> : <Clock3 size={13} />}</div><div className="space-y-1">{grouped[label].map((conversation) => <div key={conversation.id} className={`group flex items-center rounded-xl pr-1 ${conversation.id === conversationId ? "bg-violet-300/[0.08]" : "hover:bg-white/[0.035]"}`}><button onClick={() => void openConversation(conversation.id)} className={`focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-3 text-left ${conversation.id === conversationId ? "text-white" : "text-[#9a95a5] group-hover:text-white"}`}><MessageCircleMore size={16} className={conversation.id === conversationId ? "text-violet-300" : "text-[#625d6d]"} /><span className="min-w-0 flex-1 truncate text-[13px]">{conversation.title}</span></button><div className="hidden shrink-0 items-center group-hover:flex group-focus-within:flex"><button onClick={() => void updateConversation(conversation, { pinned: !conversation.pinned })} className="focus-ring grid h-8 w-8 place-items-center rounded-lg text-[#706a7d] hover:text-violet-200" aria-label={conversation.pinned ? "Unpin chat" : "Pin chat"}>{conversation.pinned ? <PinOff size={13} /> : <Pin size={13} />}</button><button onClick={() => void renameConversation(conversation)} className="focus-ring grid h-8 w-8 place-items-center rounded-lg text-[#706a7d] hover:text-white" aria-label="Rename chat"><Pencil size={13} /></button><button onClick={() => void deleteConversation(conversation)} className="focus-ring grid h-8 w-8 place-items-center rounded-lg text-[#706a7d] hover:text-rose-300" aria-label="Delete chat"><Trash2 size={13} /></button></div></div>)}</div></div> : null)}
            </div>
          </> : <div className="mt-5 flex min-h-0 flex-1 flex-col"><button onClick={wallet.openConnect} className="focus-ring flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] p-5 text-center hover:border-violet-200/20 hover:bg-violet-300/[0.025]"><span className="grid h-11 w-11 place-items-center rounded-full bg-white/[0.04] text-[#777180]"><Lock size={18} /></span><span className="mt-4 text-[13px] font-semibold text-[#d5d0de]">Connect your wallet to save your chats.</span><span className="mt-2 text-[11px] leading-5 text-[#706a7d]">Recent chats, memory, settings, and bond continuity unlock after a free login signature.</span><span className="mt-5 rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-2.5 text-xs font-semibold text-white">Connect Wallet</span></button></div>}

          <div className="mt-3 rounded-2xl border border-violet-200/[0.10] bg-violet-300/[0.04] p-3"><div className="flex items-center gap-3"><MiniCabi className="h-9 w-9" decorative /><div className="min-w-0 flex-1"><p className="text-xs font-medium text-violet-100">{wallet.authenticated ? (bond?.label ?? "Wallet companion") : "Temporary companion"}</p><p className="mt-0.5 text-[11px] text-[#706a7d]">{wallet.authenticated ? "Bond is saved independently of $CPU" : "Guest bond is not saved"}</p></div><Heart size={15} className="text-violet-300" fill="currentColor" /></div></div>
          <div className="mt-2 flex items-center gap-2"><button onClick={wallet.authenticated ? undefined : wallet.openConnect} className="focus-ring flex h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-3 text-left hover:bg-white/[0.035]"><span className="grid h-7 w-7 place-items-center rounded-full bg-white/[0.06]"><UserRound size={14} /></span><span className="truncate text-xs text-[#a8a3b3]">{wallet.authenticated && wallet.address ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : "Guest"}</span></button><Link href="/settings" className="focus-ring grid h-11 w-11 place-items-center rounded-xl text-[#706a7d] hover:bg-white/[0.035] hover:text-white" aria-label="Settings"><Settings size={17} /></Link></div>
        </aside>

        <section id="cabi-chat" className="relative flex min-h-0 min-w-0 flex-col bg-[#08070d]/55" tabIndex={-1}>
          <header className="flex h-[70px] shrink-0 items-center border-b border-white/[0.06] px-4 max-sm:h-[64px] max-sm:px-3"><button onClick={() => { setSidebarOpen(true); setProfileOpen(false); }} className="focus-ring mr-2 hidden h-11 w-11 place-items-center rounded-xl text-[#a8a3b3] hover:bg-white/[0.04] max-md:grid" aria-label="Open menu"><Menu size={20} /></button><button onClick={() => setProfileOpen(true)} className="focus-ring mr-3 hidden rounded-[14px] max-lg:block" aria-label="Open Cabi profile"><MiniCabi className="h-9 w-9" /></button><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h1 className="text-[15px] font-semibold">Cabi</h1><span className="relative h-2 w-2 rounded-full bg-emerald-300"><span className="absolute inset-0 animate-ping rounded-full bg-emerald-300/50" /></span></div><p className="truncate text-xs text-[#777180]">{status}{temporaryChat && wallet.authenticated ? " · temporary chat" : ""}</p></div><nav className="mr-3 hidden items-center gap-1 md:flex" aria-label="Primary"><Link href="/" aria-current="page" className="focus-ring rounded-xl bg-white/[0.05] px-3 py-2 text-xs font-semibold">Chat</Link><Link href="/cpu" className="focus-ring rounded-xl px-3 py-2 text-xs font-semibold text-[#8e889b] hover:bg-white/[0.035] hover:text-white">$CPU</Link></nav><WalletButton compact /><button className="focus-ring ml-2 grid h-10 w-10 place-items-center rounded-xl text-[#777180] hover:bg-white/[0.04] hover:text-white" aria-label="Conversation actions"><MoreHorizontal size={19} /></button></header>
          <div className="scrollbar-cabi flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-6 pt-8 max-sm:px-3">
            <div className={`mx-auto flex w-full max-w-[760px] flex-1 flex-col ${hasMessages ? "justify-start" : "justify-center"}`}>
              {!hasMessages ? <><motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .55 }} className="mx-auto max-w-xl text-center"><div className="relative mx-auto mb-6 hidden h-24 w-24 max-lg:grid"><div className="absolute inset-0 rounded-[30px] bg-violet-400/15 blur-2xl" /><MiniCabi className="relative h-24 w-24 rounded-[30px]" /></div><span className="inline-flex items-center gap-2 rounded-full border border-violet-200/[0.12] bg-violet-200/[0.05] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[.13em] text-violet-200"><Sparkles size={13} /> Your Cat Partner Unit</span><h2 className="mt-5 text-balance text-[clamp(2rem,4vw,3.55rem)] font-semibold leading-[1.02] tracking-[-0.055em]">Hi, I&apos;m Cabi.</h2><p className="mx-auto mt-4 max-w-md text-pretty text-base leading-7 text-[#a8a3b3]">Cute, loyal, and always by your side. Talk, chill, ask anything — I&apos;m here.</p><button onClick={beginOnboarding} className="focus-ring mt-7 inline-flex h-12 items-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-[#0b0912] shadow-[0_12px_40px_rgba(255,255,255,.1)] hover:bg-violet-100">Talk to Cabi <ArrowUp size={16} className="rotate-45" /></button><p className="mt-3 text-[11px] text-[#625d6d]">No wallet needed to start chatting.</p></motion.div><div className="mt-10 flex flex-wrap justify-center gap-2">{quickPrompts.map((prompt) => <button key={prompt} onClick={() => { setComposer(prompt); composerRef.current?.focus(); }} className="focus-ring rounded-full border border-white/[0.07] bg-white/[0.025] px-3.5 py-2 text-xs text-[#9a95a5] transition hover:border-violet-300/20 hover:bg-violet-300/[0.06] hover:text-white">{prompt}</button>)}</div></> : <ol className="space-y-6" aria-label="Conversation messages">{messages.map((message, index) => <li key={message.id}><ChatMessage message={message} onRetry={() => retry(index)} onDelete={() => void deleteMessage(message)} onEdit={() => void editMessage(message)} onShare={() => setShareMessage(message)} onReact={(reaction) => void reactToMessage(message, reaction)} /></li>)}</ol>}
              {notice && <div role="alert" className="mx-auto mt-4 flex max-w-xl items-center gap-3 rounded-xl border border-rose-300/15 bg-rose-300/[0.05] px-3 py-2 text-xs text-rose-200"><span className="flex-1">{notice}</span><button className="focus-ring grid h-8 w-8 place-items-center rounded-lg hover:bg-white/[0.05]" onClick={() => setNotice(undefined)} aria-label="Dismiss"><X size={14} /></button></div>}
              <div ref={endRef} />
            </div>
          </div>
          <div className="shrink-0 bg-gradient-to-t from-[#08070d] via-[#08070d] to-transparent px-5 cabi-safe-bottom pt-3 max-sm:px-3"><form className="mx-auto max-w-[760px]" onSubmit={submit}><div className="rounded-[24px] border border-violet-200/[0.14] bg-[#11101a] p-2 shadow-[0_18px_60px_rgba(0,0,0,.35)] focus-within:border-violet-300/30 focus-within:shadow-[0_18px_60px_rgba(0,0,0,.35),0_0_0_3px_rgba(139,92,246,.06)]"><textarea ref={composerRef} value={composer} onChange={(event) => setComposer(event.target.value)} onKeyDown={onKeyDown} rows={2} className="scrollbar-cabi max-h-40 min-h-[50px] w-full resize-none bg-transparent px-3 pt-2.5 text-[15px] leading-6 text-white outline-none placeholder:text-[#625d6d]" placeholder="What's on your mind?" aria-label="Message Cabi" disabled={sending} /><div className="flex items-center justify-between px-1 pb-1"><p className="hidden pl-2 text-[10px] text-[#5d5868] sm:block">Enter to send · Shift + Enter for a new line</p><span className="sm:hidden" />{sending ? <button type="button" onClick={() => controllerRef.current?.abort()} className="focus-ring grid h-10 w-10 place-items-center rounded-[14px] bg-white text-[#160f27]" aria-label="Stop generating"><Square size={15} fill="currentColor" /></button> : <button type="submit" disabled={!composer.trim()} className="focus-ring grid h-10 w-10 place-items-center rounded-[14px] bg-gradient-to-br from-violet-200 to-violet-400 text-[#160f27] shadow-[0_8px_24px_rgba(139,92,246,.28)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35" aria-label="Send message"><ArrowUp size={18} strokeWidth={2.4} /></button>}</div></div><p className="mt-2 text-center text-[10px] text-[#504b59]">{wallet.authenticated && !temporaryChat ? "Saved to your wallet profile · Cabi can make mistakes." : "Temporary in this tab · Cabi can make mistakes."}</p></form></div>
        </section>

        <aside className="flex min-h-0 flex-col border-l border-white/[0.065] p-3 max-lg:hidden" aria-label="Cabi presence"><PresenceArt mood="cozy" speaking={sending} authenticated={wallet.authenticated} bond={bond} /><div className="mt-3"><CpuTokenCard compact /></div></aside>
      </div>

      {sidebarOpen && <button className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm md:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close menu" />}
      {profileOpen && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm lg:hidden" role="dialog" aria-modal="true" aria-label="Cabi profile"><button className="absolute inset-0" onClick={() => setProfileOpen(false)} aria-label="Close Cabi profile" /><div className="scrollbar-cabi relative max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-[28px] border border-violet-200/10 bg-[#0b0912] p-3 shadow-2xl"><button className="focus-ring absolute right-5 top-5 z-30 grid h-10 w-10 place-items-center rounded-xl bg-black/35 text-white" onClick={() => setProfileOpen(false)} aria-label="Close"><X size={18} /></button><div className="h-[min(58dvh,520px)]"><PresenceArt mood="cozy" speaking={sending} authenticated={wallet.authenticated} bond={bond} /></div><div className="mt-3"><CpuTokenCard compact /></div></div></div>}
      {shareMessage && <div className="fixed inset-0 z-[70] grid place-items-center bg-black/75 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="share-title"><button className="absolute inset-0" onClick={() => setShareMessage(undefined)} aria-label="Close share dialog" /><div className="glass relative w-full max-w-md rounded-[28px] p-5"><div className="flex items-start gap-3"><MiniCabi className="h-11 w-11" /><div className="min-w-0 flex-1"><h2 id="share-title" className="text-lg font-semibold">Make a Cabi card</h2><p className="mt-1 text-sm text-[#8e889b]">Only this response will be added to the image.</p></div><button className="focus-ring grid h-10 w-10 place-items-center rounded-xl text-[#777180] hover:bg-white/[0.05]" onClick={() => setShareMessage(undefined)} aria-label="Close"><X size={18} /></button></div><blockquote className="mt-5 max-h-52 overflow-y-auto rounded-2xl border border-violet-200/10 bg-violet-300/[0.04] p-4 text-sm leading-6 text-[#d8d4df]">{shareMessage.content}</blockquote><div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => downloadShareCard(shareMessage.content, false)} className="focus-ring flex h-11 items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-[#0b0912]"><Download size={15} /> Square</button><button onClick={() => downloadShareCard(shareMessage.content, true)} className="focus-ring flex h-11 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] text-sm font-semibold hover:bg-white/[0.07]"><Download size={15} /> 16:9</button></div></div></div>}

      <Dialog open={savePromptOpen} onOpenChange={(open) => { if (!open && !savingGuestChat) { setSavePromptOpen(false); setTemporaryChat(true); } }}>
        <DialogContent className="glass rounded-[28px] border-violet-200/[0.12] bg-[#0b0912] text-white sm:max-w-md">
          <div className="grid h-11 w-11 place-items-center rounded-2xl border border-violet-200/15 bg-violet-300/[0.07] text-violet-200"><Check size={19} /></div>
          <DialogHeader className="mt-3 text-left"><DialogTitle>Save this conversation?</DialogTitle><DialogDescription className="leading-6 text-[#a8a3b3]">Your wallet is authenticated. Save this temporary chat to your wallet profile, or keep it only in this tab.</DialogDescription></DialogHeader>
          <div className="mt-3 grid gap-2 sm:grid-cols-2"><button disabled={savingGuestChat || sending} onClick={() => void saveGuestChat()} className="focus-ring h-11 rounded-xl bg-white text-sm font-semibold text-[#0b0912] disabled:opacity-40">{savingGuestChat ? "Saving…" : "Save Chat"}</button><button onClick={() => { setTemporaryChat(true); setSavePromptOpen(false); }} className="focus-ring h-11 rounded-xl border border-white/[0.09] bg-white/[0.03] text-sm font-semibold hover:bg-white/[0.06]">Keep Temporary</button></div>
          <p className="text-[11px] leading-5 text-[#706a7d]">Nothing from this chat is uploaded unless you choose Save Chat.</p>
        </DialogContent>
      </Dialog>
    </main>
  );
}
