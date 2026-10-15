import { defineConfig } from "tsup";

export default defineConfig([
  // 1. Library bundle for NPM (ESM + CJS + DTS)
  {
    entry: { index: "src/index.ts" },
    format: ["cjs", "esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    treeshake: true,
    minify: false
  },
  // 2. Standalone Minified Tracker for <script> tags (< 1.5 KB gzipped)
  {
    entry: { "tracker.min": "src/index.ts" },
    format: ["iife"],
    globalName: "ClickPulse",
    minify: "terser",
    terserOptions: {
      ecma: 2020,
      compress: {
        passes: 3,
        unsafe: true,
        unsafe_arrows: true,
        unsafe_comps: true,
        unsafe_methods: true,
        pure_getters: true,
        booleans_as_integers: true,
        toplevel: true,
        top_retain: ["ClickPulse"],
        keep_fargs: false
      },
      mangle: {
        toplevel: true,
        reserved: ["ClickPulse"]
      },
      format: {
        comments: false
      }
    },
    sourcemap: false,
    treeshake: true,
    outExtension() {
      return { js: ".js" };
    }
  },
  // 3. Unminified Tracker for debugging and self-hosting
  {
    entry: { tracker: "src/index.ts" },
    format: ["iife"],
    globalName: "ClickPulse",
    minify: false,
    sourcemap: true,
    treeshake: true,
    outExtension() {
      return { js: ".js" };
    }
  }
]);
