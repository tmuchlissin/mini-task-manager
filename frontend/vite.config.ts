import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiUrl = env.VITE_API_URL;
  if (!apiUrl) throw new Error("VITE_API_URL is required in frontend/.env");
  const port = Number(env.VITE_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("VITE_PORT must be a valid port in frontend/.env");
  }

  return {
    plugins: [react()],
    server: {
      port,
      strictPort: true,
      proxy: {
        "/api": apiUrl,
      },
    },
  };
});
