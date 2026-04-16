import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    // anchor/tests/*.test.ts are integration tests that need a running
    // solana-test-validator. Run them via `anchor test --skip-deploy`,
    // not vitest.
    exclude: ["**/node_modules/**", "**/dist/**", "anchor/**"],
  },
});
