import { describe, expect, it } from "vitest";

import {
  describeImplicitFact,
  extractImplicitFact,
  implicitFactKey,
  isSensitiveMemory,
  normalizeMemoryKey,
  extractMemoryIntent,
} from "@/lib/memory/extractor";
import { selectRelevantMemories } from "@/lib/memory/store";

/**
 * Cross-conversation memory.
 *
 * These tests exercise the real decision path that makes Scenario 5 work: a fact
 * stated in one conversation is extracted, stored under a wallet-scoped key, and
 * then retrieved by relevance in a *different* conversation.
 *
 * The store itself is database-backed, so the database is simulated here by
 * applying the same key semantics the unique constraint enforces. That keeps the
 * behavioural contract testable without a live Supabase project; the constraint
 * itself is verified by migration review.
 */

type Row = { category: string; content: string; normalized_key: string; importance: number };

/** Mirrors `upsert(..., { onConflict: "wallet_account_id,normalized_key" })`. */
function upsert(rows: Row[], row: Row): Row[] {
  const index = rows.findIndex((existing) => existing.normalized_key === row.normalized_key);
  if (index < 0) return [...rows, row];
  const next = [...rows];
  next[index] = row;
  return next;
}

function store(rows: Row[], message: string): Row[] {
  const fact = extractImplicitFact(message);
  if (!fact) return rows;
  return upsert(rows, {
    category: fact.category,
    content: describeImplicitFact(fact.category, fact.content, fact.normalizedKey),
    normalized_key: fact.normalizedKey,
    importance: 0.6,
  });
}

describe("scenario 5: a fact from chat A is available in chat B", () => {
  it("extracts a pet fact from a passing statement", () => {
    const fact = extractImplicitFact("My cat is named Luna.");
    expect(fact).not.toBeNull();
    if (!fact) return;
    expect(fact.category).toBe("pet");
    expect(fact.content).toBe("Luna");
    expect(fact.normalizedKey).toBe("pet:cat");
  });

  it("carries the fact across to a new conversation", () => {
    // CHAT A: the user mentions the fact in passing.
    let rows: Row[] = [];
    rows = store(rows, "My cat is named Luna.");

    // A brand new chat has no messages, but long-term memory is wallet-scoped,
    // so the fact is still there.
    expect(rows).toHaveLength(1);

    // CHAT B: the user asks about it.
    const retrieved = selectRelevantMemories(rows, "What is my cat's name?");
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0].content).toContain("Luna");
    // And the description is readable, not a bare value.
    expect(retrieved[0].content).toMatch(/cat/i);
  });

  it("answers the dog variant too", () => {
    let rows: Row[] = [];
    rows = store(rows, "My dog is named Milo.");
    const retrieved = selectRelevantMemories(rows, "what is my dog's name?");
    expect(retrieved[0].content).toContain("Milo");
  });

  it("survives a large memory list without losing the relevant fact", () => {
    let rows: Row[] = [];
    for (const message of [
      "I live in Berlin.",
      "I work as a designer.",
      "I play guitar.",
      "I love spicy food.",
      "I want to learn Rust.",
      "My cat is named Luna.",
      "My birthday is in March.",
    ]) {
      rows = store(rows, message);
    }
    const retrieved = selectRelevantMemories(rows, "What did I say my cat is called?", 3);
    expect(retrieved.some((row) => row.content.includes("Luna"))).toBe(true);
  });
});

describe("memory conflicts supersede instead of accumulating", () => {
  it("replaces the old pet name rather than keeping both", () => {
    let rows: Row[] = [];
    rows = store(rows, "My cat is named Luna.");
    rows = store(rows, "My new cat is Max.");
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toContain("Max");
    expect(rows[0].content).not.toContain("Luna");
  });

  it("keys preferences by subject so unrelated ones coexist", () => {
    let rows: Row[] = [];
    rows = store(rows, "My favourite game is Hades.");
    rows = store(rows, "My favourite food is ramen.");
    expect(rows).toHaveLength(2);
  });

  it("keys the same preference subject to one slot", () => {
    let rows: Row[] = [];
    rows = store(rows, "My favourite game is Hades.");
    rows = store(rows, "My favourite game is Celeste.");
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toContain("Celeste");
  });

  it("keeps a pet key stable across different phrasings", () => {
    expect(implicitFactKey("pet", "my cat Luna")).toBe("pet:cat");
    expect(implicitFactKey("pet", "our dog Milo")).toBe("pet:dog");
    expect(implicitFactKey("identity", "anything")).toBe("identity:name");
  });
});

describe("implicit extraction is conservative", () => {
  it("never stores a question", () => {
    for (const message of [
      "What is my cat's name?",
      "Do you remember my dog's name?",
      "Is my cat named Luna?",
      "Where do I live?",
    ]) {
      expect(extractImplicitFact(message)).toBeNull();
    }
  });

  it("never stores something about another person", () => {
    expect(extractImplicitFact("My friend's cat is named Luna.")).toBeNull();
    expect(extractImplicitFact("My brother lives in Paris.")).toBeNull();
  });

  it("never stores sensitive material", () => {
    for (const message of [
      "My name is John and my password is hunter2",
      "my seed phrase is alpha beta gamma delta",
      "my private key is 0xdeadbeef",
    ]) {
      expect(extractImplicitFact(message)).toBeNull();
    }
  });

  it("ignores chat that contains no durable fact", () => {
    for (const message of [
      "hey how are you today",
      "that is really interesting",
      "tell me more about bonding curves",
      "ok",
      "I think this is broken",
    ]) {
      expect(extractImplicitFact(message)).toBeNull();
    }
  });

  it("rejects filler values that are not facts", () => {
    expect(extractImplicitFact("my name is something")).toBeNull();
    expect(extractImplicitFact("I like it")).toBeNull();
  });

  it("bounds the stored value", () => {
    const fact = extractImplicitFact(`I live in ${"x".repeat(300)}`);
    if (!fact) return;
    expect(fact.content.length).toBeLessThanOrEqual(200);
  });
});

describe("relevance selection", () => {
  // Built through the real formatter so these fixtures cannot drift from what
  // the store actually writes.
  const memories = [
    { category: "pet", content: describeImplicitFact("pet", "Luna", "pet:cat") },
    { category: "location", content: describeImplicitFact("location", "Berlin", "location:home") },
    { category: "work", content: describeImplicitFact("work", "designer", "work") },
    { category: "goal", content: describeImplicitFact("goal", "learn Rust", "goal:current") },
    { category: "hobby", content: describeImplicitFact("hobby", "guitar", "hobby") },
    { category: "preference", content: describeImplicitFact("preference", "spicy food", "preference:spicy food") },
    { category: "date", content: describeImplicitFact("date", "March", "date:birthday") },
    { category: "identity", content: describeImplicitFact("identity", "Mark", "identity:name") },
  ];

  it("returns only what fits the limit", () => {
    expect(selectRelevantMemories(memories, "anything", 3)).toHaveLength(3);
  });

  it("prioritises the memory the question is about", () => {
    const picked = selectRelevantMemories(memories, "what is my cat's name?", 2);
    expect(picked[0].content).toContain("Luna");
  });

  it("is deterministic for identical input", () => {
    const first = selectRelevantMemories(memories, "tell me about my work", 4).map((row) => row.content);
    const second = selectRelevantMemories(memories, "tell me about my work", 4).map((row) => row.content);
    expect(first).toEqual(second);
  });

  it("falls back to the most important memories when the query carries no signal", () => {
    expect(selectRelevantMemories(memories, "hi", 3)).toHaveLength(3);
    expect(selectRelevantMemories(memories, "", 3)).toHaveLength(3);
  });

  it("returns everything when it already fits", () => {
    expect(selectRelevantMemories(memories.slice(0, 2), "anything", 6)).toHaveLength(2);
  });
});

describe("explicit memory commands still work", () => {
  it("handles remember, forget and the sensitive guard", () => {
    const remember = extractMemoryIntent("remember that I like small-cap AI coins");
    expect(remember.type).toBe("remember");
    if (remember.type === "remember") expect(remember.content).toContain("small-cap AI coins");

    expect(extractMemoryIntent("forget that I like tea").type).toBe("forget");
    expect(extractMemoryIntent("how are you").type).toBe("none");
    expect(extractMemoryIntent("remember my password is hunter2").type).toBe("none");
  });

  it("keeps a stable key for explicit facts", () => {
    expect(normalizeMemoryKey("I Like Small-Cap AI Coins!")).toBe("i like small cap ai coins");
  });

  it("flags sensitive content", () => {
    expect(isSensitiveMemory("my seed phrase is ...")).toBe(true);
    expect(isSensitiveMemory("I like cats")).toBe(false);
  });
});