import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.SMILESYNC_API_URL || "http://127.0.0.1:3001";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT || 4173),
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT || 4173),
  },
});
