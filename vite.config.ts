import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  public: "public",
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
