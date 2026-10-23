import { defineConfig } from "vite";
// Dedicated desktop development origin, with NO API proxies. Never replaces 5174.
export default defineConfig({
  base: "./",
  publicDir: false,
  envDir: "./src-tauri",
  server: {
    host: "0.0.0.0",
    port: 5180,
    strictPort: true,
    fs: {
      deny: [
        ".env",
        ".env.*",
        "**/*.{pem,key}",
        "**/.git/**",
        "**/local-ai/**",
      ],
    },
    headers: { "Cache-Control": "no-store" },
  },
});
