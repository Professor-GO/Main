import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/client",
  plugins: [react()],
  build: { outDir: "../../dist/client", emptyOutDir: true },
  server: {
    host: process.env.FRONTEND_HOST || "127.0.0.1",
    port: Number(process.env.FRONTEND_PORT || 3000),
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://${process.env.BACKEND_HOST === "0.0.0.0" ? "127.0.0.1" : process.env.BACKEND_HOST || "127.0.0.1"}:${process.env.BACKEND_PORT || 3001}`,
        changeOrigin: false,
      },
    },
  },
});
