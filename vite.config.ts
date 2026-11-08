import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = (env.VITE_API_PROXY_TARGET || "http://localhost:3000").replace(/\/$/, "");

  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/") || id.includes("node_modules/scheduler")) {
              return "react";
            }
            if (
              id.includes("node_modules/antd") ||
              id.includes("node_modules/@ant-design") ||
              id.includes("node_modules/@rc-component") ||
              id.includes("node_modules/dayjs") ||
              /node_modules\/rc-[^/]+/.test(id)
            ) {
              return "ui";
            }
            return undefined;
          },
        },
      },
    },
    server: {
      port: 5174,
      strictPort: true,
      proxy: {
        "/api": { target: apiTarget, changeOrigin: true, ws: true },
        "/health": { target: apiTarget, changeOrigin: true },
        "/ready": { target: apiTarget, changeOrigin: true },
      },
    },
  };
});
