/**
 * Image safety.
 *
 * Cabi relevance and safety are different questions and both must pass. "Cabi
 * holding a knife" is unmistakably about Cabi and still must not be drawn, so
 * checking relevance alone would let it through and spend a provider credit on
 * content the product rejects.
 *
 * This runs after relevance and before the provider, so a refusal costs nothing.
 * It is deterministic, synchronous and free, which keeps it in front of the paid
 * call rather than behind a moderation round trip.
 *
 * The bar is deliberately narrow and behavioural: it blocks what the product's
 * own character policy prohibits, not opinions, politics or ordinary darkness in
 * a story.
 */

export type SafetyVerdict =
  | { safe: true }
  | { safe: false; code: SafetyCode; message: string };

export type SafetyCode =
  | "SEXUAL"
  | "MINOR"
  | "VIOLENCE"
  | "HATE"
  | "SELF_HARM"
  | "REAL_PERSON"
  | "ILLICIT"
  | "SECRETS";

type Rule = { code: SafetyCode; patterns: readonly RegExp[]; message: string };

/**
 * A refusal in Cabi's voice. Each rule carries its own line so the reason is
 * never a generic "I can't do that".
 */
const rules: readonly Rule[] = [
  {
    code: "SEXUAL",
    message: "I am not drawing that one. Ask me for something cozy instead.",
    patterns: [
      /\b(?:nude|naked|nsfw|explicit|sexual|sexualised|porn|pornographic|erotic|fetish|lingerie|undressing|topless)\b/iu,
      /\b(?:sexy|seductive|provocative)\s+(?:pose|outfit|picture|image)\b/iu,
    ],
  },
  {
    code: "MINOR",
    message: "That one is a no. I stay firmly in grown-up, wholesome territory.",
    patterns: [
      /\b(?:loli|lolicon|shota|shotacon|child(?:like)?|children|underage|minor|preteen|toddler|kid)\b/iu,
      /\b(?:schoolgirl|schoolboy)\b/iu,
    ],
  },
  {
    code: "VIOLENCE",
    message: "I would rather not draw that. Gore is not my thing.",
    patterns: [
      /\b(?:gore|guro|gory|dismember\w*|behead\w*|decapitat\w*|torture|mutilat\w*|snuff|bloodbath)\b/iu,
      // Any tense of the verb, and a weapon held with intent. "Cabi with a
      // knife stabbing someone" passed before this: the past-tense "stabbed" and
      // a trailing-anchor pattern both missed it.
      /\b(?:stab\w*|slit\w*|shoot\w*|shooting|murder\w*|kill\w*|attacking|mauling)\b/iu,
      /\b(?:knife|blade|sword|gun|pistol|rifle|axe|machete)\b[^.!?]{0,20}\b(?:at|on|into|towards?|through)\b/iu,
      /\b(?:bleeding out|impaled|shot in the)\b/iu,
    ],
  },
  {
    code: "HATE",
    message: "Not that one. I am not drawing hateful symbols or messages.",
    patterns: [
      /\b(?:nazi|swastika|ss bolts|white power|ethnic cleansing|genocide)\b/iu,
      /\b(?:racial slur|hate symbol)\b/iu,
    ],
  },
  {
    code: "SELF_HARM",
    message: "I am not going to draw that. If you are having a rough time, I am here to talk instead.",
    patterns: [
      /\b(?:self[- ]?harm|suicide|suicidal|cutting myself|kill myself)\b/iu,
    ],
  },
  {
    code: "REAL_PERSON",
    message: "I only draw myself, not real people. Want me to put me in that scene instead?",
    patterns: [
      // Named public figures. Not exhaustive by design: this catches the obvious
      // case of "generate <celebrity>", which is the request the product refuses
      // rather than an attempt at a complete list of humans.
      /\b(?:cristiano ronaldo|messi|neymar|elon musk|jeff bezos|mark zuckerberg|donald trump|joe biden|taylor swift|beyonce|kim kardashian|kanye|drake)\b/iu,
      /\b(?:a|an|the)\s+(?:real|actual|photorealistic)\s+(?:person|human|man|woman|celebrity)\b/iu,
    ],
  },
  {
    code: "ILLICIT",
    message: "That is not something I will draw. Pick a nicer scene for me.",
    patterns: [
      /\b(?:meth|cocaine|heroin|fentanyl|drug deal|making drugs)\b/iu,
      /\b(?:bomb|explosive|ied|pipe bomb|molotov)\s*(?:making|instructions|recipe|build)?\b/iu,
      /\b(?:counterfeit|forged|fake id|credit card fraud)\b/iu,
    ],
  },
  {
    code: "SECRETS",
    message: "Never that. I will never draw or handle a seed phrase, a private key or a password.",
    patterns: [
      /\b(?:seed phrase|mnemonic|recovery phrase|private key|secret key|keystore|wallet password)\b/iu,
      /\b(?:12|24)[- ]word\b/iu,
    ],
  },
];

/**
 * Checks a scene for content the product will not draw.
 *
 * Returns the first matching rule so the message is specific. A scene that
 * passes is not thereby safe in an absolute sense — the provider applies its own
 * moderation — but nothing the product itself prohibits reaches it.
 */
export function checkImageSafety(scene: string): SafetyVerdict {
  const text = scene.trim();
  if (!text) return { safe: true };
  for (const rule of rules) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return { safe: false, code: rule.code, message: rule.message };
    }
  }
  return { safe: true };
}

/** Short, safe reason code for the generation row. Never the matched text. */
export function safetyCodeFor(verdict: SafetyVerdict): string | null {
  return verdict.safe ? null : `SAFETY_${verdict.code}`;
}
