/**
 * Shared constants for the branded first-paint veil. They live outside the
 * client component so the root layout (a server component) can build the
 * inline bootstrap without importing client code.
 */
export const veilStorageKey = "cabi:veil";
export const veilAttribute = "data-cabi-veil";
export const veilTimeoutMs = 620;
export const veilFadeMs = 240;
