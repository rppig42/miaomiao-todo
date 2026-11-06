import { defineConfig } from "vite";

// 小组件用的规则文件，见 src/core/widget.ts。
export default defineConfig({
  build: {
    target: "safari17",
    outDir: "ios/Widgets/generated",
    emptyOutDir: false,
    minify: true,
    lib: { entry: "src/core/widget-entry.ts", formats: ["iife"], name: "TodoCoreBundle", fileName: () => "widget-core.js" },
  },
});
