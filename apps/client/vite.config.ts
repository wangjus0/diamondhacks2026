import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const wsProxyTarget = process.env.MURMUR_WS_PROXY_TARGET?.trim()
  || `ws://127.0.0.1:${process.env.PORT?.trim() || "3000"}`;

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: wsProxyTarget,
        ws: true,
      },
    },
  },
});
