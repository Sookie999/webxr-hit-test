import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), mkcert()],
  server: { host: true, https: true },
  preview: { host: true, https: true },
  // GitHub Pages subpath
  base: '/webxr-hit-test/',
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@react-three/fiber",
      "@react-three/drei",
      "@react-three/xr",
      "use-sync-external-store/shim/with-selector.js"
    ],
    exclude: ["three", "three-stdlib"],
    esbuildOptions: { target: "esnext", supported: { "top-level-await": true } }
  },
  build: { target: "esnext" }
});
