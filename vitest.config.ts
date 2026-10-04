import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/client/**/*.test.tsx", "src/client/**/*.vitest.ts"],
    setupFiles: ["src/client/tests/setup.ts"],
  },
});
