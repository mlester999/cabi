import type { ActionCard, ActionCardLink } from "@/lib/actions/types";

/** Admin and owner-preview pages must never appear as chat action links. */
export function isAdminOnlyActionLink(link: Pick<ActionCardLink, "kind" | "url">): boolean {
  if (link.kind !== "INTERNAL") return false;
  const path = link.url.split(/[?#]/u, 1)[0] ?? link.url;
  return /^\/(?:admin|preview|api\/admin)(?:\/|$)/iu.test(path);
}

/** Remove links that could expose admin-only routes through a chat card. */
export function stripAdminActionLinks(card: ActionCard): ActionCard {
  const links = card.links.filter((link) => !isAdminOnlyActionLink(link));
  return links.length === card.links.length ? card : { ...card, links };
}
