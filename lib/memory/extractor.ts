export type MemoryIntent =
  | { type: "remember"; category: string; content: string; normalizedKey: string }
  | { type: "forget"; query: string }
  | { type: "none" };

const sensitive = /\b(password|passcode|private key|seed phrase|recovery phrase|social security|ssn|bank account|credit card|medical diagnosis|home address|passport|driver'?s license)\b/iu;

function categoryFor(content: string) {
  if (/\b(call me|my name is|nickname)\b/iu.test(content)) return "identity";
  if (/\b(i like|i love|favorite|prefer|don't like|hate)\b/iu.test(content)) return "preference";
  if (/\b(project|building|working on|goal)\b/iu.test(content)) return "project";
  if (/\b(communicate|responses?|concise|detailed|tone)\b/iu.test(content)) return "communication";
  return "general";
}

export function normalizeMemoryKey(content: string) {
  return content.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 160);
}

export function extractMemoryIntent(message: string): MemoryIntent {
  const trimmed = message.trim();
  const forget = trimmed.match(/^(?:please\s+)?forget\s+(?:that\s+)?(.{2,500})$/iu);
  if (forget) return { type: "forget", query: forget[1].trim() };
  const remember = trimmed.match(/^(?:please\s+)?remember(?:\s+that)?\s+(.{2,800})$/iu);
  if (!remember) return { type: "none" };
  const content = remember[1].trim();
  if (sensitive.test(content) || /\b(?:[a-z]+\s+){11,23}[a-z]+\b/iu.test(content)) return { type: "none" };
  return { type: "remember", category: categoryFor(content), content, normalizedKey: normalizeMemoryKey(content) };
}

export function isSensitiveMemory(content: string) { return sensitive.test(content); }
