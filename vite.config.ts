import { defineConfig } from "vite";

// 本地开发：base 为 "/"
// GitHub Pages：由工作流注入 BASE_PATH=/<仓库名>/
const base = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base,
  build: {
    outDir: "dist",
    target: "es2020",
    sourcemap: true,
  },
  server: {
    port: 5173,
    open: true,
  },
});