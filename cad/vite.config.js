import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  build: { outDir: "../dist-cad", emptyOutDir: true },
});
