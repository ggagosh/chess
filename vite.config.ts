import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Plugin } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const STOCKFISH_ASSETS = [
  {
    contentType: "application/javascript; charset=utf-8",
    fileName: "stockfish/stockfish-18-lite-single.js",
    sourcePath: resolve("node_modules/stockfish/bin/stockfish-18-lite-single.js"),
  },
  {
    contentType: "application/wasm",
    fileName: "stockfish/stockfish-18-lite-single.wasm",
    sourcePath: resolve("node_modules/stockfish/bin/stockfish-18-lite-single.wasm"),
  },
] as const;

function stockfishAssetPlugin(): Plugin {
  return {
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requestPath = req.url?.split("?")[0];
        const asset = STOCKFISH_ASSETS.find((entry) => `/${entry.fileName}` === requestPath);

        if (!asset) {
          next();
          return;
        }

        res.setHeader("Content-Type", asset.contentType);
        res.end(readFileSync(asset.sourcePath));
      });
    },
    generateBundle() {
      for (const asset of STOCKFISH_ASSETS) {
        this.emitFile({
          fileName: asset.fileName,
          source: readFileSync(asset.sourcePath),
          type: "asset",
        });
      }
    },
    name: "stockfish-assets",
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), stockfishAssetPlugin()],
});
