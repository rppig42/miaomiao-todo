import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5174,
    strictPort: true,
    watch: { ignored: ["**/.mygo/**", "**/build/**", "**/native/**", "**/signing/**"] },
  },
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  build: { target: "safari17" },
});
