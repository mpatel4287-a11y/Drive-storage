import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/auth": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/media": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/members": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/permissions": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/folders": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/qr": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/drive": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/health": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
