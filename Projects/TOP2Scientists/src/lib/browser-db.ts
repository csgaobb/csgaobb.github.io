import type { SearchParams, SortKey } from "./search";
import type { FilterOptions, ListType, ScientistRecord, SiteStats } from "./types";

const SHARD_SIZE = 400;
const BROAD_LIMIT = 4000;

type ReadyPayload = { stats: SiteStats; filters: FilterOptions; current: boolean };

type OrderInfo = {
  file?: string;
  nulls?: number;
  contiguous?: boolean;
  start?: number;
  count?: number;
  sameAs?: string;
};

type FacetEntry = { name: string; count: number; file: string };

type Catalog = {
  listType: ListType;
  count: number;
  shardSize: number;
  orders: Record<string, OrderInfo>;
  countries: FacetEntry[];
  fields: FacetEntry[];
  subfields: FacetEntry[];
  broadInstitutionLimit?: number;
};

type CardRow = {
  n: string;
  a: string;
  c: string;
  f: string;
  s: string;
  r: number | null;
  rs: number | null;
  ci: number | null;
  h: number | null;
  cs: number | null;
};

type InstitutionDictionary = { names: string[]; counts: number[]; buckets: number[] };

export type SearchPayload = {
  items: ScientistRecord[];
  total: number;
  broad?: boolean;
};

let manifest: SiteStats | null = null;
let activeList: ListType | null = null;
let switchSerial = 0;
const catalogs = new Map<ListType, Catalog>();
const orders = new Map<string, number[]>();
const facets = new Map<string, number[]>();
const nameBlocks = new Map<string, Record<string, number[]>>();
const institutions = new Map<ListType, InstitutionDictionary>();
const institutionBuckets = new Map<string, Record<string, number[]>>();
const cards = new Map<number, Record<string, CardRow>>();
const cardLoads = new Map<number, Promise<Record<string, CardRow>>>();
const detailShards = new Map<number, Record<string, ScientistRecord>>();
const detailLoads = new Map<number, Promise<Record<string, ScientistRecord>>>();
const verifiedNames = new Map<string, number[]>();

function assetUrl(filename: string) {
  return new URL(filename, document.baseURI).href;
}

function listFolder(listType: ListType) {
  return listType === "career" ? "career" : "single-year";
}

async function readJson<T>(file: string): Promise<T> {
  const response = await fetch(assetUrl(file));
  if (!response.ok) throw new Error("The official 2026 database could not be loaded.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = file.endsWith(".gz") ? await ungzip(bytes) : new TextDecoder().decode(bytes);
  return JSON.parse(text) as T;
}

async function ungzip(bytes: Uint8Array) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser cannot open the search index.");
  }
  const stream = new Blob([bytes.buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

async function loadManifest(): Promise<SiteStats> {
  if (manifest) return manifest;
  const payload = await readJson<SiteStats>("data/manifest.json");
  manifest = { ...payload, dataReady: true };
  return manifest;
}

async function loadCatalog(listType: ListType) {
  const cached = catalogs.get(listType);
  if (cached) return cached;
  const catalog = await readJson<Catalog>(`data/index/${listFolder(listType)}/catalog.json`);
  catalogs.set(listType, catalog);
  return catalog;
}

function filtersFrom(catalog: Catalog): FilterOptions {
  return {
    fields: catalog.fields.map((item) => item.name),
    subfields: catalog.subfields.map((item) => item.name),
    countries: catalog.countries.map((item) => ({ name: item.name, count: item.count })),
  };
}

function letterFile(token: string) {
  const character = token[0] ?? "";
  if ((character >= "a" && character <= "z") || (character >= "0" && character <= "9")) return character;
  const point = character.codePointAt(0) ?? 0;
  return `u${point.toString(16)}`;
}

function nameTokens(name: string) {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of name.match(/[^\W\d_]+/gu) ?? []) {
    const token = raw.toLowerCase();
    if (token.length < 2 || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

function institutionTokens(name: string) {
  return name
    .toLowerCase()
    .replace(/,/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter(Boolean);
}

function phraseMatch(name: string, query: string[]) {
  const words = institutionTokens(name);
  if (query.length === 1) return words.some((word) => word.startsWith(query[0]));
  for (let start = 0; start <= words.length - query.length; start += 1) {
    const window = words.slice(start, start + query.length);
    const prefix = window.every((word, index) =>
      index === query.length - 1 ? word.startsWith(query[index]) : word === query[index],
    );
    if (prefix) return true;
  }
  return false;
}

function nameOrderMatch(name: string, query: string[]) {
  const words = nameTokens(name);
  if (query.length === 1) return words.some((word) => word.startsWith(query[0]));
  for (let start = 0; start <= words.length - query.length; start += 1) {
    const window = words.slice(start, start + query.length);
    const prefix = window.every((word, index) =>
      index === query.length - 1 ? word.startsWith(query[index]) : word === query[index],
    );
    if (prefix) return true;
  }
  return false;
}

function queryTokens(query: string) {
  return nameTokens(query);
}

async function loadOrder(listType: ListType, sort: SortKey) {
  const catalog = await loadCatalog(listType);
  const info = catalog.orders[sort] ?? catalog.orders.rank;
  if (info.sameAs) return loadOrder(listType, info.sameAs as SortKey);
  const key = `${listType}:${sort}`;
  const cached = orders.get(key);
  if (cached) return cached;
  if (info.contiguous && info.start !== undefined && info.count) {
    const ids = Array.from({ length: info.count }, (_, index) => (info.start ?? 0) + index);
    orders.set(key, ids);
    return ids;
  }
  const ids = await readJson<number[]>(`data/index/${listFolder(listType)}/${info.file}`);
  orders.set(key, ids);
  return ids;
}

async function loadFacet(listType: ListType, kind: "country" | "field" | "subfield", name: string) {
  const catalog = await loadCatalog(listType);
  const entry = catalog[kind === "country" ? "countries" : kind === "field" ? "fields" : "subfields"].find(
    (item) => item.name === name,
  );
  if (!entry) return [];
  const key = `${listType}:${kind}:${entry.file}`;
  const cached = facets.get(key);
  if (cached) return cached;
  const ids = await readJson<number[]>(
    `data/index/${listFolder(listType)}/${kind}/${entry.file}.json.gz`,
  );
  facets.set(key, ids);
  return ids;
}

async function loadNameBlock(listType: ListType, letter: string) {
  const key = `${listType}:${letter}`;
  const cached = nameBlocks.get(key);
  if (cached) return cached;
  try {
    const block = await readJson<Record<string, number[]>>(
      `data/index/${listFolder(listType)}/names/${letter}.json.gz`,
    );
    nameBlocks.set(key, block);
    return block;
  } catch {
    const empty = {};
    nameBlocks.set(key, empty);
    return empty;
  }
}

async function loadInstitutions(listType: ListType) {
  const cached = institutions.get(listType);
  if (cached) return cached;
  const dictionary = await readJson<InstitutionDictionary>(
    `data/index/${listFolder(listType)}/institutions.json.gz`,
  );
  institutions.set(listType, dictionary);
  return dictionary;
}

async function loadInstitutionBucket(listType: ListType, bucket: number) {
  const key = `${listType}:${bucket}`;
  const cached = institutionBuckets.get(key);
  if (cached) return cached;
  const payload = await readJson<Record<string, number[]>>(
    `data/index/${listFolder(listType)}/institution-ids/${String(bucket).padStart(4, "0")}.json.gz`,
  );
  institutionBuckets.set(key, payload);
  return payload;
}

async function loadCardShard(bucket: number) {
  const cached = cards.get(bucket);
  if (cached) return cached;
  const pending = cardLoads.get(bucket);
  if (pending) return pending;
  const load = readJson<Record<string, CardRow>>(`data/cards/${String(bucket).padStart(4, "0")}.json.gz`)
    .then((shard) => {
      cards.set(bucket, shard);
      return shard;
    })
    .catch((error) => {
      cardLoads.delete(bucket);
      throw error;
    });
  cardLoads.set(bucket, load);
  return load;
}

function cardRecord(id: number, card: CardRow, listType: ListType): ScientistRecord {
  return {
    id,
    scopusId: "",
    listType,
    rankGlobal: card.r,
    rankSubfield: card.rs,
    name: card.n,
    affiliation: card.a,
    country: card.c,
    field: card.f,
    subfield: card.s,
    subfield2: "",
    papers: null,
    citations: card.ci,
    citationsAll: null,
    hIndex: card.h,
    hIndexAll: null,
    hmIndex: null,
    hmIndexAll: null,
    cScore: card.cs,
    cScoreAll: null,
    rankGlobalAll: null,
    singlePapers: null,
    singlePapersAll: null,
    singleCites: null,
    singleCitesAll: null,
    firstPapers: null,
    firstPapersAll: null,
    firstCites: null,
    firstCitesAll: null,
    lastPapers: null,
    lastPapersAll: null,
    lastCites: null,
    lastCitesAll: null,
    citingPapers: null,
    citingPapersAll: null,
    citeRatio: null,
    citeRatioAll: null,
    percentile: null,
    selfCitationPct: null,
    firstPublicationYear: null,
    lastPublicationYear: null,
    subfieldCount: null,
    metricsLoaded: false,
  };
}

async function cardsFor(ids: number[], listType: ListType) {
  const buckets = new Map<number, number[]>();
  for (const id of ids) {
    const bucket = Math.floor(id / SHARD_SIZE);
    const group = buckets.get(bucket);
    if (group) group.push(id);
    else buckets.set(bucket, [id]);
  }
  const shards = await Promise.all([...buckets.keys()].map((bucket) => loadCardShard(bucket)));
  const byBucket = new Map<number, Record<string, CardRow>>();
  [...buckets.keys()].forEach((bucket, index) => byBucket.set(bucket, shards[index]));
  return ids.map((id) => {
    const card = byBucket.get(Math.floor(id / SHARD_SIZE))?.[String(id)];
    return card ? cardRecord(id, card, listType) : null;
  }).filter((item): item is ScientistRecord => item !== null);
}

function intersect(lists: number[][]) {
  const ordered = [...lists].sort((left, right) => left.length - right.length);
  let current = new Set(ordered[0]);
  for (const list of ordered.slice(1)) {
    const next = new Set<number>();
    for (const id of list) if (current.has(id)) next.add(id);
    current = next;
  }
  return [...current];
}

function idAt(ids: number[], index: number, descending: boolean, nulls: number) {
  if (!descending) return ids[index];
  const body = ids.length - nulls;
  if (index < body) return ids[body - 1 - index];
  return ids[index];
}

async function orderInfo(listType: ListType, sort: SortKey) {
  const catalog = await loadCatalog(listType);
  let info = catalog.orders[sort] ?? catalog.orders.rank;
  if (info.sameAs) info = catalog.orders[info.sameAs] ?? info;
  return info;
}

async function pageFromPopulation(
  listType: ListType,
  sort: SortKey,
  descending: boolean,
  page: number,
  pageSize: number,
  allowed?: Set<number>,
) {
  const info = await orderInfo(listType, sort);
  const start = (page - 1) * pageSize;
  if (info.contiguous && info.start !== undefined && info.count && !allowed) {
    const total = info.count;
    const ids = Array.from({ length: Math.max(0, Math.min(pageSize, total - start)) }, (_, index) => {
      const position = start + index;
      return descending ? (info.start ?? 0) + total - 1 - position : (info.start ?? 0) + position;
    });
    return { total, ids };
  }
  const sequence = await loadOrder(listType, info.sameAs ? (info.sameAs as SortKey) : sort);
  const nulls = info.nulls ?? 0;
  if (!allowed) {
    const total = sequence.length;
    const ids = Array.from({ length: Math.max(0, Math.min(pageSize, total - start)) }, (_, index) =>
      idAt(sequence, start + index, descending, nulls),
    );
    return { total, ids };
  }
  const matched: number[] = [];
  for (let index = 0; index < sequence.length; index += 1) {
    const id = idAt(sequence, index, descending, nulls);
    if (allowed.has(id)) matched.push(id);
  }
  return { total: matched.length, ids: matched.slice(start, start + pageSize) };
}

async function nameIds(listType: ListType, query: string) {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return { ids: [] as number[], verify: false };
  const groups = await Promise.all(tokens.map((token) => loadNameBlock(listType, letterFile(token))));
  const sets = tokens.map((token, index) => {
    const block = groups[index] as Record<string, number[]>;
    const prefix = index === tokens.length - 1;
    const ids = new Set<number>();
    for (const [word, postings] of Object.entries(block)) {
      if (prefix ? word.startsWith(token) : word === token) {
        for (const id of postings) ids.add(id);
      }
    }
    return [...ids];
  });
  return { ids: sets.length === 1 ? sets[0] : intersect(sets), verify: tokens.length > 1, tokens };
}

async function institutionIds(listType: ListType, query: string) {
  const tokens = institutionTokens(query).filter((token) => token.length >= 2);
  if (tokens.length === 0) return { ids: [] as number[], broad: false };
  const dictionary = await loadInstitutions(listType);
  const matched: number[] = [];
  let people = 0;
  dictionary.names.forEach((name, index) => {
    if (!phraseMatch(name, tokens)) return;
    matched.push(index);
    people += dictionary.counts[index] ?? 0;
  });
  const limit = (await loadCatalog(listType)).broadInstitutionLimit ?? BROAD_LIMIT;
  if (people > limit) return { ids: [], broad: true, total: people };
  const byBucket = new Map<number, number[]>();
  for (const index of matched) {
    const bucket = dictionary.buckets[index] ?? 0;
    const group = byBucket.get(bucket);
    if (group) group.push(index);
    else byBucket.set(bucket, [index]);
  }
  const ids = new Set<number>();
  await Promise.all(
    [...byBucket.entries()].map(async ([bucket, indexes]) => {
      const payload = await loadInstitutionBucket(listType, bucket);
      for (const index of indexes) for (const id of payload[String(index)] ?? []) ids.add(id);
    }),
  );
  return { ids: [...ids], broad: false };
}

async function verifyNameOrder(listType: ListType, ids: number[], tokens: string[]) {
  const cacheKey = `${listType}:${tokens.join(" ")}:${ids.length}`;
  const cached = verifiedNames.get(cacheKey);
  if (cached) return cached;
  const records = await cardsFor(ids, listType);
  const matched = records.filter((record) => nameOrderMatch(record.name, tokens)).map((record) => record.id);
  verifiedNames.set(cacheKey, matched);
  return matched;
}

export async function ensureSearchList(
  listType: ListType,
  onProgress?: (ratio: number, phase: string) => void,
): Promise<ReadyPayload> {
  const serial = ++switchSerial;
  onProgress?.(0.4, "Loading list");
  const stats = await loadManifest();
  const catalog = await loadCatalog(listType);
  if (serial !== switchSerial) return { stats, filters: filtersFrom(catalog), current: false };
  activeList = listType;
  onProgress?.(1, "Ready");
  return { stats, filters: filtersFrom(catalog), current: true };
}

async function loadDetailShard(bucket: number) {
  const cached = detailShards.get(bucket);
  if (cached) return cached;
  const pending = detailLoads.get(bucket);
  if (pending) return pending;
  const load = readJson<Record<string, ScientistRecord>>(`data/details/${String(bucket).padStart(4, "0")}.json.gz`)
    .then((shard) => {
      detailShards.set(bucket, shard);
      return shard;
    })
    .catch((error) => {
      detailLoads.delete(bucket);
      throw error;
    });
  detailLoads.set(bucket, load);
  return load;
}

export async function getScientist(id: number): Promise<ScientistRecord | null> {
  if (!id) return null;
  const stats = await loadManifest();
  const shardSize = stats.shardSize || SHARD_SIZE;
  const shard = await loadDetailShard(Math.floor(id / shardSize));
  return shard[String(id)] ?? null;
}

export async function searchScientists(params: SearchParams): Promise<SearchPayload> {
  if (activeList !== params.listType) return { items: [], total: 0 };
  const pageSize = params.pageSize;
  const page = params.page;
  const sort = params.sort ?? "rank";
  const descending = params.order === "desc";
  const query = params.q?.trim() ?? "";
  const tokens = queryTokens(query);
  let allowed: number[] | undefined;
  if (query && (params.scope ?? "name") === "affiliation") {
    const found = await institutionIds(params.listType, query);
    if (found.broad) return { items: [], total: found.total ?? 0, broad: true };
    allowed = found.ids;
  } else if (tokens.length > 0) {
    const found = await nameIds(params.listType, query);
    allowed = found.verify ? await verifyNameOrder(params.listType, found.ids, found.tokens ?? tokens) : found.ids;
  }
  const facetLists: number[][] = [];
  if (params.country) facetLists.push(await loadFacet(params.listType, "country", params.country));
  if (params.field) facetLists.push(await loadFacet(params.listType, "field", params.field));
  if (params.subfield) facetLists.push(await loadFacet(params.listType, "subfield", params.subfield));
  if (allowed) facetLists.push(allowed);
  const restriction = facetLists.length ? new Set(intersect(facetLists)) : undefined;
  const pageIds = await pageFromPopulation(
    params.listType,
    sort,
    descending,
    page,
    pageSize,
    restriction,
  );
  return {
    items: await cardsFor(pageIds.ids, params.listType),
    total: pageIds.total,
  };
}

export async function getFilterOptions(listType: ListType): Promise<FilterOptions> {
  if (activeList !== listType) return { fields: [], subfields: [], countries: [] };
  return filtersFrom(await loadCatalog(listType));
}
