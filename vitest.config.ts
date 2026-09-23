import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./", import.meta.url)),
  "server-only": fileURLToPath(new URL("./tests/server-only.ts", import.meta.url)),
};

export default defineConfig({
  // Server modules in this project are React Server Components; the automatic
  // JSX runtime keeps `next/og` image modules compilable under test.
  esbuild: { jsx: "automatic" },
  resolve: { alias },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    restoreMocks: true,
    clearMocks: true,
    globals: true,
    // Browser-plane tests (rendered components) opt into jsdom by location so
    // the server-plane suites keep the fast Node environment.
    environmentMatchGlobs: [
      ["tests/dom/**", "jsdom"],
      ["**/*.test.tsx", "jsdom"],
    ],
    setupFiles: ["tests/setup-dom.ts"],
  },
});
