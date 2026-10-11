import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import wasmBinary from "virtual:sqlite3-wasm";
import {
  bindParams,
  buildSearchSql,
  buildSuggestSql,
  mapRecord,
  type RawRecord,
  type SearchParams,
  type SearchScope,
} from "./search";
import type { FilterOptions, ListType, SiteStats, SuggestItem } from "./types";

type SqliteDatabase = {
  prepare: (sql: string) => {
    bind: (values: Record<string, string | number>) => unknown;
    step: () => boolean;
    get: (target: Record<string, unknown>) => Record<string, unknown>;
    finalize: () => void;
  };
  checkRc: (result: number) => unknown;
};

type Sqlite3Static = {
  wasm: { allocFromTypedArray: (bytes: Uint8Array) => number };
  oo1: { DB: new () => SqliteDatabase };
  capi: {
    sqlite3_deserialize: (
      db: SqliteDatabase,
      schema: string,
      pointer: number,
      dbSize: number,
      bufferSize: number,
      flags: number,
    ) => number;
    SQLITE_DESERIALIZE_FREEONCLOSE: number;
    SQLITE_DESERIALIZE_READONLY: number;
  };
};

let database: SqliteDatabase | null = null;
const filterCache = new Map<ListType, FilterOptions>();

function yieldToUi() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

function asNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value !== "") return Number(value);
  return 0;
}

function usedBinds(sql: string, values?: Record<string, string | number>) {
  if (!values) return undefined;
  const bound = bindParams(values);
  return Object.fromEntries(Object.entries(bound).filter(([key]) => sql.includes(key)));
}

function queryAll(sql: string, values?: Record<string, string | number>) {
  if (!database) throw new Error("Database is not loaded");
  const statement = database.prepare(sql);
  try {
    const bound = usedBinds(sql, values);
    if (bound && Object.keys(bound).length > 0) statement.bind(bound);
    const rows: Record<string, unknown>[] = [];
    while (statement.step()) rows.push(statement.get({}));
    return rows;
  } finally {
    statement.finalize();
  }
}

export async function openEngine(
  bytes: Uint8Array,
  onProgress?: (ratio: number, phase: string) => void,
) {
  onProgress?.(0.55, "Preparing search engine");
  await yieldToUi();
  const sqlite3 = await (
    sqlite3InitModule as unknown as (config?: Record<string, unknown>) => Promise<Sqlite3Static>
  )({
    wasmBinary,
    print: () => undefined,
    printErr: () => undefined,
  });
  onProgress?.(0.72, "Opening official database");
  await yieldToUi();
  const pointer = sqlite3.wasm.allocFromTypedArray(bytes);
  const db = new sqlite3.oo1.DB();
  const result = sqlite3.capi.sqlite3_deserialize(
    db,
    "main",
    pointer,
    bytes.byteLength,
    bytes.byteLength,
    sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_READONLY,
  );
  db.checkRc(result);
  database = db;
}

export function isEngineReady() {
  return database !== null;
}

export function getRecordById(id: number) {
  const rows = queryAll(
    "SELECT * FROM records WHERE id = $id LIMIT 1",
    { id },
  ) as unknown as RawRecord[];
  return rows[0] ? mapRecord(rows[0]) : null;
}

export function searchEngine(params: SearchParams) {
  const { countSql, selectSql, values } = buildSearchSql(params);
  const total = asNumber(queryAll(countSql, values)[0]?.count);
  const rows = queryAll(selectSql, values) as unknown as RawRecord[];
  return { items: rows.map(mapRecord), total };
}

export function suggestEngine(query: string, listType: ListType, scope: SearchScope = "all"): SuggestItem[] {
  const built = buildSuggestSql(query, listType, scope);
  if (!built.expression) return [];
  return queryAll(built.sql, built.values).map((row) => ({
    id: asNumber(row.id),
    name: String(row.name ?? ""),
    affiliation: String(row.affiliation ?? ""),
    country: String(row.country ?? ""),
    field: String(row.field ?? ""),
    rankGlobal: row.rank_global == null ? null : asNumber(row.rank_global),
  }));
}

export function readFilters(listType: ListType): FilterOptions {
  const cached = filterCache.get(listType);
  if (cached) return cached;
  const list = (column: "field" | "subfield" | "country") =>
    queryAll(
      `SELECT DISTINCT ${column} AS value FROM records
       WHERE list_type = $listType AND ${column} <> ''
       ORDER BY ${column} COLLATE NOCASE`,
      { listType },
    ).map((row) => String(row.value ?? ""));
  const filters = {
    fields: list("field"),
    subfields: list("subfield"),
    countries: list("country"),
  };
  filterCache.set(listType, filters);
  return filters;
}

export function readStats(): SiteStats {
  const row = queryAll(
    `SELECT
        SUM(list_type = 'career') AS total_career,
        SUM(list_type = 'single_year') AS total_single_year,
        COUNT(DISTINCT NULLIF(affiliation, '')) AS institutions,
        COUNT(DISTINCT NULLIF(country, '')) AS countries,
        COUNT(DISTINCT NULLIF(field, '')) AS fields,
        COUNT(DISTINCT NULLIF(subfield, '')) AS subfields
       FROM records`,
  )[0];
  return {
    totalCareer: asNumber(row?.total_career),
    totalSingleYear: asNumber(row?.total_single_year),
    institutions: asNumber(row?.institutions),
    countries: asNumber(row?.countries),
    fields: asNumber(row?.fields),
    subfields: asNumber(row?.subfields),
    dataReady: true,
  };
}
