import type { ListType } from "./types";

export const searchScopes = ["name", "affiliation"] as const;
export type SearchScope = (typeof searchScopes)[number];

export const sortKeys = ["rank", "subfieldRank", "cScore", "citations", "hIndex", "name"] as const;
export type SortKey = (typeof sortKeys)[number];

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

export function queryTokens(query: string) {
  return query
    .normalize("NFKC")
    .split(/\s+/)
    .map((token) => token.replace(/["*:^()[\]{}]/g, "").trim())
    .filter((token) => token.length >= 2)
    .slice(0, 8);
}
