import { matchCountryCodes } from "./country-flag";
import type { ListType, ScientistRecord } from "./types";

export const searchScopes = ["all", "name", "affiliation", "country", "field"] as const;
export type SearchScope = (typeof searchScopes)[number];

const ftsColumn: Record<Exclude<SearchScope, "all">, string> = {
  name: "name",
  affiliation: "affiliation",
  country: "country",
  field: "field",
};

export type RawRecord = {
  id: number;
  scopus_id: string;
  list_type: ListType;
  rank_global: number | null;
  rank_subfield: number | null;
  name: string;
  affiliation: string;
  country: string;
  field: string;
  subfield: string;
  papers: number | null;
  citations: number | null;
  h_index: number | null;
  hm_index: number | null;
  c_score: number | null;
  percentile: number | null;
  self_citation_pct: number | null;
  first_publication_year: number | null;
  last_publication_year: number | null;
};

export function mapRecord(row: RawRecord): ScientistRecord {
  return {
    id: row.id,
    scopusId: row.scopus_id,
    listType: row.list_type,
    rankGlobal: row.rank_global,
    rankSubfield: row.rank_subfield,
    name: row.name,
    affiliation: row.affiliation,
    country: row.country,
    field: row.field,
    subfield: row.subfield,
    papers: row.papers,
    citations: row.citations,
    hIndex: row.h_index,
    hmIndex: row.hm_index,
    cScore: row.c_score,
    percentile: row.percentile,
    selfCitationPct: row.self_citation_pct,
    firstPublicationYear: row.first_publication_year,
    lastPublicationYear: row.last_publication_year,
  };
}

export const columnMap = {
  rank: "r.rank_global",
  subfieldRank: "r.rank_subfield",
  cScore: "r.c_score",
  citations: "r.citations",
  hIndex: "r.h_index",
  name: "r.name COLLATE NOCASE",
} as const;

export type SortKey = keyof typeof columnMap;

export interface SearchParams {
  q?: string;
  scope?: SearchScope;
  listType: ListType;
  field?: string;
  subfield?: string;
  country?: string;
  sort?: SortKey;
  order?: "asc" | "desc";
  page: number;
  pageSize: number;
}

export function ftsExpression(query: string, scope: SearchScope = "all") {
  const tokens = query
    .normalize("NFKC")
    .split(/\s+/)
    .map((token) => token.replace(/["*:^()[\]{}]/g, "").trim())
    .filter(Boolean)
    .slice(0, 8);
  if (tokens.length === 0) return "";
  const raw =
    tokens.length === 1
      ? `"${tokens[0]}"*`
      : `"${tokens.slice(0, -1).join(" ")} ${tokens[tokens.length - 1]}" OR "${tokens.slice(0, -1).join(" ")} ${tokens[tokens.length - 1]}*"`;
  if (scope === "all") return raw;
  const column = ftsColumn[scope];
  return raw
    .split(" OR ")
    .map((part) => `${column} : ${part}`)
    .join(" OR ");
}

export function buildSearchSql(params: SearchParams) {
  const clauses = ["r.list_type = $listType"];
  const values: Record<string, string | number> = {
    listType: params.listType,
    limit: params.pageSize,
    offset: (params.page - 1) * params.pageSize,
  };

  let from = "records r";
  const scope = params.scope ?? "all";
  const query = params.q?.trim() ?? "";
  if (query && scope === "country") {
    const codes = matchCountryCodes(query);
    if (codes.length === 1) {
      clauses.push("r.country = $countryQuery");
      values.countryQuery = codes[0];
    } else if (codes.length > 1) {
      const keys = codes.map((code, index) => {
        const key = `country${index}`;
        values[key] = code;
        return `$${key}`;
      });
      clauses.push(`r.country IN (${keys.join(", ")})`);
    } else {
      const expression = ftsExpression(query, "country");
      if (expression) {
        from = "records_fts f JOIN records r ON r.id = f.rowid";
        clauses.push("records_fts MATCH $query");
        values.query = expression;
      }
    }
  } else if (query) {
    const expression = ftsExpression(query, scope);
    if (expression) {
      from = "records_fts f JOIN records r ON r.id = f.rowid";
      clauses.push("records_fts MATCH $query");
      values.query = expression;
    }
  }
  if (params.field) {
    clauses.push("r.field = $field");
    values.field = params.field;
  }
  if (params.subfield) {
    clauses.push("r.subfield = $subfield");
    values.subfield = params.subfield;
  }
  if (params.country) {
    clauses.push("r.country = $country");
    values.country = params.country;
  }

  const where = clauses.join(" AND ");
  const hasQuery = Boolean(values.query);
  const sortKey = params.sort ?? "rank";
  const sortColumn = columnMap[sortKey];
  const order = params.order === "desc" ? "DESC" : "ASC";
  const relevanceFirst = hasQuery && sortKey === "rank" && order === "ASC";
  const nullPlacement = relevanceFirst
    ? `bm25(records_fts) ASC, r.rank_global IS NULL ASC, r.rank_global ASC`
    : order === "ASC"
      ? `${sortColumn} IS NULL ASC, ${sortColumn} ASC`
      : `${sortColumn} IS NULL ASC, ${sortColumn} DESC`;

  return {
    countSql: `SELECT COUNT(*) AS count FROM ${from} WHERE ${where}`,
    selectSql: `SELECT r.* FROM ${from} WHERE ${where}
       ORDER BY ${nullPlacement}, r.id ASC LIMIT $limit OFFSET $offset`,
    values,
  };
}

export function buildSuggestSql(query: string, listType: ListType, scope: SearchScope = "all") {
  if (scope === "country") {
    const codes = matchCountryCodes(query);
    if (codes.length > 0) {
      const values: Record<string, string | number> = { listType };
      const keys = codes.map((code, index) => {
        const key = `country${index}`;
        values[key] = code;
        return `$${key}`;
      });
      return {
        sql: `SELECT r.id, r.name, r.affiliation, r.country, r.field, r.rank_global
           FROM records r
           WHERE r.list_type = $listType AND r.country IN (${keys.join(", ")})
           ORDER BY r.rank_global IS NULL ASC, r.rank_global ASC
           LIMIT 8`,
        values,
        expression: "country",
      };
    }
  }
  const expression = ftsExpression(query, scope);
  return {
    sql: `SELECT r.id, r.name, r.affiliation, r.country, r.field, r.rank_global
       FROM records_fts f JOIN records r ON r.id = f.rowid
       WHERE r.list_type = $listType AND records_fts MATCH $query
       ORDER BY bm25(records_fts), r.rank_global IS NULL ASC, r.rank_global ASC
       LIMIT 8`,
    values: { listType, query: expression },
    expression,
  };
}

export function queryTokens(query: string) {
  return query
    .normalize("NFKC")
    .split(/\s+/)
    .map((token) => token.replace(/["*:^()[\]{}]/g, "").trim())
    .filter((token) => token.length >= 2)
    .slice(0, 8);
}

export function bindParams(values: Record<string, string | number>) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key.startsWith("$") ? key : `$${key}`,
      value,
    ]),
  );
}
