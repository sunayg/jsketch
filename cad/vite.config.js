import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  // the solid kernel runs in a module worker and loads its WASM dynamically
  worker: { format: "es" },
  build: { outDir: "../dist-cad", emptyOutDir: true, target: "es2022" },
  optimizeDeps: { exclude: ["manifold-3d"] },
});
