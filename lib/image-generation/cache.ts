/**
 * Image generation timings.
 *
 * Signed storage URLs are short-lived on purpose: a generated image is private
 * by default, so a link that leaks stops working. This module exists so the two
 * places that mint a URL cannot disagree about how long it lasts.
 */

/** How long a signed image URL stays valid. Ten minutes covers a chat session. */
export const imageGenerationTtlMs = 10 * 60_000;

/** How long a provider's model list is trusted before it is re-read. */
export const imageSettingsTtlMs = 60_000;