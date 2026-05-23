import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: new URL(".", import.meta.url).pathname,
  plugins: [react()],
  resolve: {
    extensions: [".tsx", ".ts", ".jsx", ".js"],
  },
  build: {
    manifest: true,
    rollupOptions: {
      input: { main: "src/client/main.tsx" },
    },
    outDir: "dist/client",
    emptyOutDir: true,
  },
});
