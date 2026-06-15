import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Resolve the Clerk publishable key at build time directly from process.env.
// Multiple env-var names may be present (VITE_* and the Next.js-style
// NEXT_PUBLIC_*), and one of them can hold a stale/invalid value. We pick the
// first candidate that actually looks like a Clerk publishable key (pk_test_ /
// pk_live_) so a junk value under either name can't shadow the real one. The
// chosen value is injected via `define` below, bypassing Vite's envPrefix env
// loading entirely.
const CLERK_PUBLISHABLE_KEY =
  [
    process.env.VITE_CLERK_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  ].find((k) => typeof k === "string" && /^pk_(test|live)_/.test(k)) ?? "";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  // Expose both Vite-native (VITE_) and Next.js-style (NEXT_PUBLIC_) public env
  // vars to the client build. NEXT_PUBLIC_ is public by convention, so this does
  // not leak server secrets (e.g. CLERK_SECRET_KEY has neither prefix).
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  // Inject the validated Clerk publishable key as a compile-time constant so it
  // is guaranteed baked into the bundle regardless of env-var naming/precedence.
  define: {
    __CLERK_PUBLISHABLE_KEY__: JSON.stringify(CLERK_PUBLISHABLE_KEY),
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
