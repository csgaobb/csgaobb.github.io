import type { SearchParams, SearchScope } from "./search";
import {
  getRecordById,
  openEngine,
  readFilters,
  readStats,
  searchEngine,
  suggestEngine,
} from "./sqlite-engine";
import type { FilterOptions, ListType, ScientistRecord, SiteStats, SuggestItem } from "./types";

const DATABASE_PATHS = [
  "data/scientists.db.gz",
  "scientists.db.gz",
  "data/scientists.db",
  "scientists.db",
];
const IDB_NAME = "top2scientists";
const IDB_STORE = "files";
const IDB_KEY = "scientists.db";

type ReadyPayload = { stats: SiteStats; filters: FilterOptions };

let ready: ReadyPayload | null = null;
let loadPromise: Promise<ReadyPayload> | null = null;

function assetUrl(filename: string) {
  return new URL(filename, document.baseURI).href;
}

function concatChunks(chunks: Uint8Array[], totalLength: number) {
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function openFileStore() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(IDB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readIndexedDatabase() {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openFileStore();
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const request = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(IDB_KEY);
      request.onsuccess = () => {
        const value = request.result;
        resolve(value instanceof Uint8Array ? value : value ? new Uint8Array(value) : null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function writeIndexedDatabase(bytes: Uint8Array) {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openFileStore();
    await new Promise<void>((resolve, reject) => {
      const request = db
        .transaction(IDB_STORE, "readwrite")
        .objectStore(IDB_STORE)
        .put(bytes, IDB_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Quota or private mode — search still works from memory.
  }
}

function asReadable(response: Response, gzip: boolean) {
  if (!response.body) return null;
  if (gzip && typeof DecompressionStream === "function") {
    return response.body.pipeThrough(new DecompressionStream("gzip"));
  }
  return response.body;
}

async function readResponse(
  response: Response,
  gzip: boolean,
  onProgress?: (ratio: number, phase: string) => void,
) {
  const total = Number(response.headers.get("content-length") || 0);
  const stream = asReadable(response, gzip);
  if (!stream) {
    let bytes = new Uint8Array(await response.arrayBuffer());
    if (gzip && typeof DecompressionStream === "function") {
      onProgress?.(0.82, "Unpacking official database");
      bytes = new Uint8Array(
        await new Response(
          new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
        ).arrayBuffer(),
      );
    }
    return bytes;
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.(
      total > 0 ? Math.min(0.08 + (loaded / (gzip ? 229 * 1024 * 1024 : total)) * 0.42, 0.5) : 0.2,
      "Loading official database",
    );
  }
  return concatChunks(chunks, loaded);
}

async function downloadDatabase(onProgress?: (ratio: number, phase: string) => void) {
  for (const file of DATABASE_PATHS) {
    try {
      const response = await fetch(assetUrl(file));
      if (!response.ok) continue;
      return await readResponse(response, file.endsWith(".gz"), onProgress);
    } catch {
      // Try the next official path.
    }
  }
  throw new Error("The official 2026 database could not be loaded.");
}

async function loadBytes(
  source: Blob | undefined,
  onProgress?: (ratio: number, phase: string) => void,
) {
  if (source) {
    onProgress?.(0.35, "Reading selected file");
    const bytes = new Uint8Array(await source.arrayBuffer());
    await writeIndexedDatabase(bytes);
    return bytes;
  }
  onProgress?.(0.08, "Checking local cache");
  const cached = await readIndexedDatabase();
  if (cached) return cached;
  const bytes = await downloadDatabase(onProgress);
  await writeIndexedDatabase(bytes);
  return bytes;
}

export async function loadDatabase(
  onProgress?: (ratio: number, phase: string) => void,
  source?: Blob,
  listType: ListType = "single_year",
) {
  if (ready) {
    onProgress?.(1, "Ready");
    return ready;
  }
  if (!loadPromise) {
    loadPromise = (async () => {
      const bytes = await loadBytes(source, onProgress);
      await openEngine(bytes, onProgress);
      onProgress?.(0.86, "Counting official lists");
      const stats = readStats();
      onProgress?.(0.94, "Loading filters");
      const filters = readFilters(listType);
      ready = { stats, filters };
      onProgress?.(1, "Ready");
      return ready;
    })().catch((error) => {
      loadPromise = null;
      throw error;
    });
  }
  return loadPromise;
}

export async function getScientist(id: number): Promise<ScientistRecord | null> {
  if (!ready || !id) return null;
  return getRecordById(id);
}

export async function searchScientists(params: SearchParams) {
  if (!ready) return { items: [], total: 0 };
  return searchEngine(params);
}

export async function suggestScientists(
  query: string,
  listType: ListType,
  scope: SearchScope = "all",
): Promise<SuggestItem[]> {
  if (!ready || !query.trim()) return [];
  return suggestEngine(query, listType, scope);
}

export async function getFilterOptions(listType: ListType): Promise<FilterOptions> {
  if (!ready) return { fields: [], subfields: [], countries: [] };
  return readFilters(listType);
}
