export type ListType = "career" | "single_year";

export interface ScientistRecord {
  id: number;
  scopusId: string;
  listType: ListType;
  rankGlobal: number | null;
  rankSubfield: number | null;
  name: string;
  affiliation: string;
  country: string;
  field: string;
  subfield: string;
  papers: number | null;
  citations: number | null;
  hIndex: number | null;
  hmIndex: number | null;
  cScore: number | null;
  percentile: number | null;
  selfCitationPct: number | null;
  firstPublicationYear: number | null;
  lastPublicationYear: number | null;
  subfieldCount: number | null;
  subfield2: string;
  rankGlobalAll: number | null;
  citationsAll: number | null;
  hIndexAll: number | null;
  hmIndexAll: number | null;
  cScoreAll: number | null;
  singlePapers: number | null;
  singlePapersAll: number | null;
  singleCites: number | null;
  singleCitesAll: number | null;
  firstPapers: number | null;
  firstPapersAll: number | null;
  firstCites: number | null;
  firstCitesAll: number | null;
  lastPapers: number | null;
  lastPapersAll: number | null;
  lastCites: number | null;
  lastCitesAll: number | null;
  citingPapers: number | null;
  citingPapersAll: number | null;
  citeRatio: number | null;
  citeRatioAll: number | null;
  metricsLoaded?: boolean;
}

export interface SearchResponse {
  items: ScientistRecord[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  broad?: boolean;
}

export interface FilterOptions {
  fields: string[];
  subfields: string[];
  countries: { name: string; count: number }[];
}

export interface SiteStats {
  totalCareer: number;
  totalSingleYear: number;
  institutions: number;
  countries: number;
  fields: number;
  subfields: number;
  dataReady: boolean;
  shardSize?: number;
}
