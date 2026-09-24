"use client";

import { CornerDownLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { matchingSlashCommands, type SlashCommand } from "@/lib/actions/slash-commands";

/**
 * Slash command palette.
 *
 * Appears only while the composer holds a bare `/...` token, so it never intrudes
 * on normal typing. Commands that need an answer from Cabi are sent as an
 * ordinary message and handled by the server action layer; commands that only
 * navigate resolve locally. There are no decorative entries - every command in
 * the list does something real.
 */
export function SlashCommandPalette({
  value,
  onRun,
  onNavigate,
}: {
  value: string;
  /** Send the command text to Cabi (action layer handles it server-side). */
  onRun: (command: SlashCommand) => void;
  /** Navigate to a route-backed command. */
  /** Optional: fires when a route-backed command is followed. */
  onNavigate?: (href: string) => void;
}) {
  const matches = useMemo(() => matchingSlashCommands(value), [value]);
  const [active, setActive] = useState(0);

  // Clamp rather than reset in an effect: the candidate list only shrinks as the
  // user types, so an out-of-range index just needs bounding at render time.
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1));

  useEffect(() => {
    if (matches.length === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      // Only intercept arrows while the palette is genuinely showing.
      event.preventDefault();
      setActive((current) => {
        const next = event.key === "ArrowDown" ? current + 1 : current - 1;
        return (next + matches.length) % matches.length;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [matches.length]);

  if (matches.length === 0) return null;

  const rowClass = (index: number) =>
    `flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition ${index === activeIndex ? "bg-violet-300/[0.09]" : "hover:bg-[var(--cabi-surface-2)]"}`;

  const rowBody = (command: SlashCommand, index: number) => (
    <>
      <span className="w-[92px] shrink-0 font-mono text-[12px] text-[var(--cabi-primary)]">{command.id}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-white">{command.title}</span>
        <span className="block truncate text-[11px] text-[var(--cabi-text-muted)]">{command.description}</span>
      </span>
      {index === activeIndex && <CornerDownLeft size={13} className="shrink-0 text-[var(--cabi-text-faint)]" aria-hidden="true" />}
    </>
  );

  return (
    <div
      role="listbox"
      aria-label="Cabi commands"
      className="mx-auto mb-2 w-full max-w-[760px] overflow-hidden rounded-xl border border-violet-200/[0.14] bg-[var(--cabi-surface)]/96 p-1.5 shadow-[0_18px_50px_rgba(0,0,0,.45)] backdrop-blur-xl"
    >
      {matches.map((command, index) => (
        command.href ? (
          // Route-backed commands are real links, so they work with keyboard,
          // middle-click and open-in-new-tab, and need no router context.
          <a
            key={command.id}
            href={command.href}
            role="option"
            aria-selected={index === activeIndex}
            onMouseEnter={() => setActive(index)}
            onClick={() => onNavigate?.(command.href!)}
            className={rowClass(index)}
          >
            {rowBody(command, index)}
          </a>
        ) : (
          <button
            key={command.id}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            onMouseEnter={() => setActive(index)}
            onClick={() => onRun(command)}
            className={rowClass(index)}
          >
            {rowBody(command, index)}
          </button>
        )
      ))}
    </div>
  );
}