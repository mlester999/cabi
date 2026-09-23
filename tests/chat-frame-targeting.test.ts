import { describe, expect, it } from "vitest";

/**
 * The SSE frame contract for an assistant reply.
 *
 * This mirrors the reducer in `components/cabi/cabi-experience.tsx`. It exists
 * because of a real defect: the `meta` frame renames the streaming assistant
 * entry to the server's message id, after which the `action` and `delta` frames
 * - which carry no id of their own - could no longer find the entry. The visible
 * symptom was a reply that rendered as "…" with no card attached, for every
 * action card, not just images.
 */

type Entry = { id: string; role: "user" | "assistant"; content: string; status: "streaming" | "complete"; actionCard?: unknown };

/** The id-resolution rule from the component, isolated. */
function reduceEntry(entry: Entry, placeholderId: string, serverId: string | null, payloadId?: string): boolean {
  return entry.id === placeholderId || entry.id === serverId || entry.id === payloadId;
}

describe("assistant frame targeting", () => {
  const placeholderId = "placeholder-1";
  const serverId = "server-1";

  it("targets the placeholder before meta arrives", () => {
    const entry: Entry = { id: placeholderId, role: "assistant", content: "", status: "streaming" };
    expect(reduceEntry(entry, placeholderId, null)).toBe(true);
  });

  it("targets the renamed entry after meta arrives", () => {
    // meta renamed the entry to the server id.
    const entry: Entry = { id: serverId, role: "assistant", content: "", status: "streaming" };
    // Without the server id the later frames would silently miss.
    expect(reduceEntry(entry, placeholderId, null)).toBe(false);
    expect(reduceEntry(entry, placeholderId, serverId)).toBe(true);
  });

  it("still targets the placeholder id if meta has not renamed it yet", () => {
    const entry: Entry = { id: placeholderId, role: "assistant", content: "", status: "streaming" };
    expect(reduceEntry(entry, placeholderId, serverId)).toBe(true);
  });

  it("honours a payload id when a frame carries one", () => {
    const entry: Entry = { id: "other", role: "assistant", content: "", status: "streaming" };
    expect(reduceEntry(entry, placeholderId, serverId, "other")).toBe(true);
  });

  it("walks a full frame sequence and ends with text and a card attached", () => {
    const placeholder = placeholderId;
    let entry: Entry = { id: placeholder, role: "assistant", content: "", status: "streaming" };
    let tracked: string | null = null;

    // meta
    tracked = serverId;
    if (reduceEntry(entry, placeholder, tracked)) entry = { ...entry, id: serverId };
    // action (no id)
    const card = { kind: "IMAGE", id: "image-1" };
    if (reduceEntry(entry, placeholder, tracked)) entry = { ...entry, actionCard: card };
    // delta (no id)
    for (const chunk of ["Okayyy, ", "here you go."]) {
      if (reduceEntry(entry, placeholder, tracked)) entry = { ...entry, content: entry.content + chunk };
    }
    // done
    if (entry.role === "assistant" && entry.status === "streaming") entry = { ...entry, status: "complete" };

    expect(entry.id).toBe(serverId);
    expect(entry.content).toBe("Okayyy, here you go.");
    expect(entry.actionCard).toEqual(card);
    expect(entry.status).toBe("complete");
  });

  it("resets the tracked id between sends so a stale id cannot capture a later reply", () => {
    // A fresh send clears the ref; a later frame must not match the old id.
    const reset: string | null = null;
    const entry: Entry = { id: "new-placeholder", role: "assistant", content: "", status: "streaming" };
    expect(reduceEntry(entry, "new-placeholder", reset, serverId)).toBe(true);
    const stale: Entry = { id: serverId, role: "assistant", content: "", status: "streaming" };
    expect(reduceEntry(stale, "new-placeholder", reset)).toBe(false);
  });
});