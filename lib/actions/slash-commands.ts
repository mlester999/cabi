/**
 * Slash commands.
 *
 * Commands are a shortcut, never the primary interface: every one of them maps
 * to something reachable in natural language, and the palette only advertises
 * commands that actually do something. There are no decorative placeholders.
 */

export type SlashCommandId =
  | "/cpu"
  | "/wallet"
  | "/memory"
  | "/bond"
  | "/help"
  | "/new"
  | "/settings";

export type SlashCommand = {
  id: SlashCommandId;
  title: string;
  description: string;
  /** Where the command takes the user, when it navigates instead of answering. */
  href?: string;
  /** Client-only commands are handled in the chat shell without a round trip. */
  client?: "NEW_CHAT";
  aliases?: string[];
};

export const slashCommands: readonly SlashCommand[] = [
  { id: "/cpu", title: "$CPU", description: "Show the Cat Partner Unit token, contract and links." },
  { id: "/wallet", title: "Wallet", description: "Check the connected wallet, network and balance." },
  { id: "/memory", title: "Memory", description: "See and manage what Cabi remembers about you.", href: "/settings/memory" },
  { id: "/bond", title: "Bond", description: "Open your relationship with Cabi.", href: "/cabi" },
  { id: "/help", title: "Help", description: "What Cabi can do, and how to ask." },
  { id: "/new", title: "New chat", description: "Start a fresh conversation.", client: "NEW_CHAT" },
  { id: "/settings", title: "Settings", description: "Appearance, memory, sound and your data.", href: "/settings" },
] as const;

export type ParsedSlashCommand =
  | { matched: true; command: SlashCommand; rest: string }
  | { matched: false };

/**
 * Parses a message that starts with a slash command.
 *
 * An unknown slash token is reported as unmatched rather than guessed at, so
 * `/whatever` falls through to Cabi instead of silently doing nothing.
 */
export function parseSlashCommand(message: string): ParsedSlashCommand {
  const trimmed = message.trim();
  if (!trimmed.startsWith("/")) return { matched: false };
  const [head, ...tail] = trimmed.split(/\s+/u);
  const normalized = head.toLowerCase();
  const command = slashCommands.find((item) => item.id === normalized || item.aliases?.includes(normalized));
  if (!command) return { matched: false };
  return { matched: true, command, rest: tail.join(" ").trim() };
}

/** Commands matching a partial input, for the composer's command palette. */
export function matchingSlashCommands(input: string): SlashCommand[] {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("/")) return [];
  // Only offer the palette while the user is still typing the command itself.
  if (/\s/u.test(trimmed)) return [];
  const query = trimmed.toLowerCase();
  return slashCommands.filter((command) => command.id.startsWith(query));
}
