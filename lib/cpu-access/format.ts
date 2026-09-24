/**
 * Exact token amount formatting for the holder gate.
 *
 * Isomorphic on purpose: the server formats the amounts it authorized with, and
 * the browser only ever *displays* those numbers. Nothing in this file decides
 * access - authorization is a raw `bigint` comparison performed on the server.
 *
 * The rules that matter:
 *
 * - Only integer/bigint arithmetic is used. A balance is never routed through a
 *   JavaScript `number` on its way to an authorization decision, so a value near
 *   the threshold cannot be rounded across it.
 * - Display is truncated *toward zero*, never rounded up, so the modal can never
 *   tell a holder they have more than they do.
 * - Grouping separators come from a hand-rolled formatter rather than
 *   `Intl.NumberFormat`, so server and client always render identically.
 */

const groupSeparatorPattern = /\B(?=(\d{3})+(?!\d))/gu;

/** Groups an integer digit string in threes: `1245662` -> `1,245,662`. */
export function groupDigits(value: string): string {
  return value.replace(groupSeparatorPattern, ",");
}

export type FormattedAmount = {
  /** Display text, truncated to at most `maxFractionDigits` decimal places. */
  text: string;
  /** True when the exact value has more precision than `text` shows. */
  truncated: boolean;
};

/**
 * Formats a raw base-unit bigint using the contract's own decimals.
 *
 * `formatAmount(742350n * 10n ** 18n, 18)` -> `{ text: "742,350", truncated: false }`
 */
export function formatAmount(raw: bigint, decimals: number, maxFractionDigits = 6): FormattedAmount {
  const scale = Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : 0;
  const negative = raw < 0n;
  const absolute = negative ? -raw : raw;
  const base = 10n ** BigInt(scale);
  const whole = absolute / base;
  const fraction = absolute % base;

  let text = groupDigits(whole.toString());
  let truncated = false;
  if (fraction > 0n) {
    const digits = fraction.toString().padStart(scale, "0");
    const visible = digits.slice(0, Math.max(0, maxFractionDigits)).replace(/0+$/u, "");
    if (visible) text += `.${visible}`;
    if (digits.slice(Math.max(0, maxFractionDigits)).replace(/0+$/u, "").length > 0) truncated = true;
  }
  return { text: negative ? `-${text}` : text, truncated };
}

/** A whole-number requirement, which is how the product states minimums. */
export function formatWholeAmount(value: number): string {
  return groupDigits(Math.max(0, Math.trunc(value)).toString());
}

/** `0x1234...ABCD` - never renders a full address inside the gate UI. */
export function shortenWalletAddress(address: string, leading = 6, trailing = 4): string {
  if (address.length <= leading + trailing + 1) return address;
  return `${address.slice(0, leading)}…${address.slice(-trailing)}`;
}
