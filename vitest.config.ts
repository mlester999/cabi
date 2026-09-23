import { fileURLToPath } from "node:url";
import { defineConfig, defineProject } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./", import.meta.url)),
  "server-only": fileURLToPath(new URL("./tests/server-only.ts", import.meta.url)),
};

const include = ["tests/**/*.test.ts", "tests/**/*.test.tsx"];
const exclude = ["node_modules/**", "dist/**", ".next/**"];

export default defineConfig({
  resolve: { alias },
  test: {
    restoreMocks: true,
    clearMocks: true,
    globals: true,
    // Vitest 5 removed `environmentMatchGlobs`; projects replace it. Server-plane
    // suites keep the fast Node environment, and the rendered-component suites
    // opt into jsdom by location.
    projects: [
      defineProject({
        resolve: { alias },
        test: {
          name: "server",
          environment: "node",
          include,
          exclude: [...exclude, "tests/dom/**"],
        },
      }),
      defineProject({
        resolve: { alias },
        test: {
          name: "browser",
          environment: "jsdom",
          include: ["tests/dom/**/*.test.ts", "tests/dom/**/*.test.tsx"],
          exclude,
          setupFiles: ["tests/setup-dom.ts"],
        },
      }),
    ],
  },
});
