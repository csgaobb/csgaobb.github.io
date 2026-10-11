import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const databaseFiles: Record<string, string> = {
  "/scientists.db": path.join(projectRoot, "data/scientists.db"),
  "/data/scientists.db": path.join(projectRoot, "data/scientists.db"),
  "/scientists.db.gz": path.join(projectRoot, "data/scientists.db.gz"),
  "/data/scientists.db.gz": path.join(projectRoot, "data/scientists.db.gz"),
};

function sqliteWasmInline(): Plugin {
  return {
    name: "sqlite-wasm-inline",
    resolveId(id) {
      if (id === "virtual:sqlite3-wasm") return id;
    },
    load(id) {
      if (id !== "virtual:sqlite3-wasm") return;
      const file = path.join(
        projectRoot,
        "node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm",
      );
      const base64 = readFileSync(file).toString("base64");
      return `const binary = Uint8Array.from(atob(${JSON.stringify(base64)}), (character) => character.charCodeAt(0));
export default binary;`;
    },
  };
}

function stubSqliteWorkers(): Plugin {
  return {
    name: "stub-sqlite-workers",
    transform(code, id) {
      if (!id.includes("@sqlite.org/sqlite-wasm")) return;
      return {
        code: code
          .replace(/new Worker\(new URL\([^;]+;/g, "null;")
          .replace(/new URL\(\s*"\?"\s*,\s*import\.meta\.url\s*\)/g, '""'),
        map: null,
      };
    },
  };
}

function sendOfficialDatabase(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) {
  const url = request.url?.split("?")[0] ?? "";
  const file = databaseFiles[url];
  if (!file) return next();
  if (!existsSync(file)) {
    response.statusCode = 404;
    response.end("official database missing");
    return;
  }
  response.setHeader("Content-Type", "application/octet-stream");
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

function classicFileScripts(): Plugin {
  return {
    name: "classic-file-scripts",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (fileName.includes("sqlite3") && (fileName.endsWith(".wasm") || fileName.includes("opfs"))) {
          delete bundle[fileName];
        }
      }
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
    sqliteWasmInline(),
    stubSqliteWorkers(),
    attachDatabase(),
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
