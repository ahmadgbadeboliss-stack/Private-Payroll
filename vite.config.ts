import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
// Note: with build.target = "esnext", top-level await is emitted natively
// and the vite-plugin-top-level-await transform is unnecessary.

// Vite config for the Private Payroll dApp.
//
// The Midnight runtime stack (onchain-runtime / ledger) ships as WASM, so we
// enable the wasm + top-level-await plugins and split the WASM into its own
// chunk, following the official Midnight examples.
export default defineConfig({
  cacheDir: "./.vite",
  build: {
    target: "esnext",
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Separate chunk for WASM modules to avoid top-level await issues.
          if (id.includes("onchain-runtime-v3") || id.includes("wasm")) return "wasm";
        }
      }
    },
    commonjsOptions: {
      transformMixedEsModules: true,
      extensions: [".js", ".cjs"],
      ignoreDynamicRequires: true
    }
  },
  plugins: [
    react(),
    wasm()
  ],
  server: {
    port: 5173,
    strictPort: false
  }
});
