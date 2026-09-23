import { describe, expect, it } from "vitest";
import { extractMemoryIntent, isSensitiveMemory } from "@/lib/memory/extractor";

describe("memory intent extraction", () => {
  it("extracts explicit useful memories", () => {
    expect(extractMemoryIntent("remember that my favorite game is Hades")).toMatchObject({ type: "remember", category: "preference", content: "my favorite game is Hades" });
  });

  it("supports explicit forget requests", () => {
    expect(extractMemoryIntent("forget that I like horror movies")).toEqual({ type: "forget", query: "I like horror movies" });
  });

  it("rejects sensitive automatic storage", () => {
    expect(extractMemoryIntent("remember that my seed phrase is apple boat candy dog echo fox green hill ice jump kite lemon")).toEqual({ type: "none" });
    expect(isSensitiveMemory("my credit card number is 1")).toBe(true);
  });

  it("does not mine casual messages", () => {
    expect(extractMemoryIntent("I had ramen today")).toEqual({ type: "none" });
  });
});
