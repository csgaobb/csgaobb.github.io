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
}

export interface SearchResponse {
  items: ScientistRecord[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface FilterOptions {
  fields: string[];
  subfields: string[];
  countries: string[];
}

export interface SiteStats {
  totalCareer: number;
  totalSingleYear: number;
  institutions: number;
  countries: number;
  fields: number;
  subfields: number;
  dataReady: boolean;
}

export interface SuggestItem {
  id: number;
  name: string;
  affiliation: string;
  country: string;
  field: string;
  rankGlobal: number | null;
}
