# Extractable components

No public layout component is independently reusable in the baseline: the public shell is currently embedded in the page-level `CabiExperience`. Skip component extraction for the wallet / CPU design round so the draft can model the requested shared public navigation explicitly.

## MiniCabi

- Source: `components/cabi/mini-cabi.tsx`
- Category: basic
- Description: Compact optional-image Cabi identity mark with a resilient monogram fallback.
- Extractable props: none required for page-to-page state.
- Hardcoded: asset path, fallback mark, violet surface styling.

