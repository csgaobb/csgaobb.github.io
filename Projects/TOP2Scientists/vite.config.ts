import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const dataRoot = path.join(projectRoot, "data");

function sendOfficialDatabase(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) {
  const url = request.url?.split("?")[0] ?? "";
  const relative = url.startsWith("/data/") ? url.slice("/data/".length) : "";
  if (!relative) return next();
  const file = path.resolve(dataRoot, relative);
  if (!file.startsWith(`${dataRoot}${path.sep}`)) return next();
  if (!existsSync(file)) {
    response.statusCode = 404;
    response.end("official database missing");
    return;
  }
  response.setHeader("Content-Type", "application/octet-stream");
  response.setHeader("Content-Length", String(statSync(file).size));
  createReadStream(file).pipe(response);
}

function attachDatabase(): Plugin {
  return {
    name: "attach-database",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        sendOfficialDatabase(request, response, next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        sendOfficialDatabase(request, response, next);
      });
    },
  };
}

function attachAssets(): Plugin {
  return {
    name: "attach-assets",
    configureServer(server) {
      const assetsRoot = path.join(projectRoot, "assets");
      server.middlewares.use((request, response, next) => {
        const url = request.url?.split("?")[0] ?? "";
        if (!url.startsWith("/assets/")) return next();
        const file = path.resolve(assetsRoot, url.slice("/assets/".length));
        if (!file.startsWith(`${assetsRoot}${path.sep}`) || !existsSync(file)) return next();
        response.setHeader("Content-Type", "image/png");
        response.setHeader("Content-Length", String(statSync(file).size));
        createReadStream(file).pipe(response);
      });
    },
  };
}

function classicFileScripts(): Plugin {
  return {
    name: "classic-file-scripts",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const htmlEntry = Object.values(bundle).find(
        (item) => item.type === "asset" && item.fileName.endsWith(".html"),
      );
      if (!htmlEntry || htmlEntry.type !== "asset" || typeof htmlEntry.source !== "string") {
        return;
      }

      htmlEntry.fileName = "index.html";
      htmlEntry.source = `\uFEFF${htmlEntry.source
        .replace(/\s*type="module"/g, "")
        .replace(/\s*crossorigin(="[^"]*")?/g, "")
        .replace(/<script src="[^"]+"><\/script>\s*/, "")
        .replace(
          "</body>",
          `    <script src="./app.js" charset="utf-8"></script>\n  </body>`,
        )}`;
    },
  };
}

export default defineConfig({
  root: path.join(projectRoot, "src"),
  publicDir: false,
  base: "./",
  plugins: [
    react(),
    tailwindcss(),
    attachDatabase(),
    attachAssets(),
    classicFileScripts(),
  ],
  build: {
    outDir: projectRoot,
    emptyOutDir: false,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "app.js",
        assetFileNames: (asset) =>
          asset.names?.[0]?.endsWith(".css") ? "app.css" : "assets/[name][extname]",
      },
    },
  },
});
