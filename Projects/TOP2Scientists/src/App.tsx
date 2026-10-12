import { useEffect, useRef, useState } from "react";
import { DetailPanel } from "./components/ScientistCard";
import {
  getFilterOptions,
  getScientist,
  ensureSearchList,
  searchScientists,
} from "./lib/browser-db";
import { Highlight } from "./lib/highlight";
import {
  ArrowDownUp,
  ChevronLeft,
  ChevronRight,
  Filter,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  X,
} from "./lib/icons";
import { countryLabel, countryOptionLabel } from "./lib/country-flag";
import type { SearchScope, SortKey } from "./lib/search";
import { searchScopes } from "./lib/search";
import type {
  FilterOptions,
  ListType,
  ScientistRecord,
  SearchResponse,
  SiteStats,
} from "./lib/types";

const emptyResponse: SearchResponse = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 25,
  pageCount: 0,
};

const emptyFilters: FilterOptions = { fields: [], subfields: [], countries: [] };

const emptyStats: SiteStats = {
  totalCareer: 0,
  totalSingleYear: 0,
  institutions: 0,
  countries: 0,
  fields: 0,
  subfields: 0,
  dataReady: false,
};

const sortKeys = new Set<SortKey>(["rank", "subfieldRank", "cScore", "citations", "hIndex", "name"]);
const scopeSet = new Set<SearchScope>(searchScopes);

const scopeLabels: Record<SearchScope, string> = {
  name: "Name",
  affiliation: "Institution",
};

const scopePlaceholders: Record<SearchScope, string> = {
  name: "Family name, Given name",
  affiliation: "University, institute, or company",
};

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  const sort = params.get("sort");
  const list = params.get("list");
  return {
    query: params.get("q") ?? "",
    scope: scopeSet.has(params.get("scope") as SearchScope) ? (params.get("scope") as SearchScope) : "name",
    listType: list === "career" ? "career" : "single_year",
    field: params.get("field") ?? "",
    subfield: params.get("subfield") ?? "",
    country: params.get("country") ?? "",
    sort: sortKeys.has(sort as SortKey) ? (sort as SortKey) : "rank",
    order: params.get("order") === "desc" ? "desc" : "asc",
    page: Math.max(1, Number(params.get("page")) || 1),
    id: Math.max(0, Number(params.get("id")) || 0),
  } as const;
}

function writeUrlState(state: {
  query: string;
  scope: SearchScope;
  listType: ListType;
  field: string;
  subfield: string;
  country: string;
  sort: SortKey;
  order: "asc" | "desc";
  page: number;
  id: number;
}) {
  const params = new URLSearchParams();
  if (state.id) params.set("id", String(state.id));
  if (state.query) params.set("q", state.query);
  if (state.scope !== "name") params.set("scope", state.scope);
  if (state.listType !== "single_year") params.set("list", state.listType);
  if (state.field) params.set("field", state.field);
  if (state.subfield) params.set("subfield", state.subfield);
  if (state.country) params.set("country", state.country);
  if (state.sort !== "rank") params.set("sort", state.sort);
  if (state.order !== "asc") params.set("order", state.order);
  if (state.page > 1) params.set("page", String(state.page));
  const query = params.toString();
  const next = query ? `?${query}` : window.location.pathname + window.location.hash;
  if (`${window.location.search}` === (query ? `?${query}` : "") ) return;
  window.history.replaceState(null, "", next);
}

function formatInteger(value: number) {
  return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatCompact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return formatInteger(value);
}

function formatNumber(value: number | null, compact = false) {
  if (value === null || value === undefined) return "—";
  return compact ? formatCompact(value) : formatInteger(value);
}

function Select({
  value,
  onChange,
  children,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="min-w-0 flex-1">
      <span className="mb-1 block text-[11px] font-medium text-slate-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/10"
      >
        {children}
      </select>
    </label>
  );
}

export function App() {
  const start = readUrlState();
  const [listType, setListType] = useState<ListType>(start.listType);
  const [queryInput, setQueryInput] = useState(start.query);
  const [query, setQuery] = useState(start.query);
  const [scope, setScope] = useState<SearchScope>(start.scope);
  const [field, setField] = useState(start.field);
  const [subfield, setSubfield] = useState(start.subfield);
  const [country, setCountry] = useState(start.country);
  const [sort, setSort] = useState<SortKey>(start.sort);
  const [order, setOrder] = useState<"asc" | "desc">(start.order);
  const [page, setPage] = useState(start.page);
  const [stats, setStats] = useState(emptyStats);
  const [filters, setFilters] = useState(emptyFilters);
  const [dbReady, setDbReady] = useState(false);
  const [dbProgress, setDbProgress] = useState(0);
  const [dbPhase, setDbPhase] = useState("Preparing");
  const [dbError, setDbError] = useState("");
  const [selected, setSelected] = useState<ScientistRecord | null>(null);
  const [openId, setOpenId] = useState(start.id);
  const [showFilters, setShowFilters] = useState(false);
  const [result, setResult] = useState(emptyResponse);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [activeScope, setActiveScope] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const pinSentinelRef = useRef<HTMLDivElement>(null);
  const searchSeq = useRef(0);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    let cancel = false;
    setDbError("");
    setDbReady(false);
    setDbProgress(0);
    setDbPhase(listType === "career" ? "Loading Career-long search index" : "Loading 2026 single-year search index");
    ensureSearchList(listType, (ratio, phase) => {
      if (cancel) return;
      setDbProgress(ratio);
      if (phase) setDbPhase(phase);
    })
      .then((payload) => {
        if (cancel || !payload.current) return;
        setStats(payload.stats);
        setFilters(payload.filters);
        setDbReady(true);
      })
      .catch((error: unknown) => {
        if (cancel) return;
        setDbError(error instanceof Error ? error.message : "Failed to load database");
      });
    return () => {
      cancel = true;
    };
  }, [listType]);

  useEffect(() => {
    const sentinel = pinSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setPinned(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(queryInput.trim());
      setPage(1);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  useEffect(() => {
    writeUrlState({ query, scope, listType, field, subfield, country, sort, order, page, id: openId });
  }, [country, field, listType, openId, order, page, query, scope, sort, subfield]);

  useEffect(() => {
    if (!openId) return;
    if (selected?.id === openId && selected.metricsLoaded) return;
    getScientist(openId).then((row) => {
      if (!row) {
        setOpenId(0);
        return;
      }
      setSelected(row);
      setListType(row.listType);
    });
  }, [openId, selected?.id, selected?.metricsLoaded]);

  useEffect(() => {
    if (!dbReady) return;
    getFilterOptions(listType).then(setFilters).catch(() => undefined);
  }, [dbReady, listType]);

  useEffect(() => {
    if (!dbReady) return;
    const id = ++searchSeq.current;
    searchScientists({
      q: query,
      scope,
      listType,
      field,
      subfield,
      country,
      sort,
      order,
      page,
      pageSize: 25,
    })
      .then((data) => {
        if (id !== searchSeq.current) return;
        setResult({
          items: data.items,
          total: data.total,
          page,
          pageSize: 25,
          pageCount: Math.ceil(data.total / 25),
          broad: data.broad,
        });
      })
      .catch(() => {
        if (id !== searchSeq.current) return;
        setResult(emptyResponse);
      });
  }, [country, dbReady, field, listType, order, page, query, scope, sort, subfield]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (selected) closeScientist();
        return;
      }
      if (event.key === "/" && event.target instanceof HTMLElement) {
        const tag = event.target.tagName;
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const loading = !dbReady && !dbError;

  function openScientist(scientist: ScientistRecord) {
    setSelected(scientist);
    setOpenId(scientist.id);
    if (scientist.listType !== listType) setListType(scientist.listType);
  }

  function closeScientist() {
    setSelected(null);
    setOpenId(0);
  }

  function resetFilters() {
    setField("");
    setSubfield("");
    setCountry("");
    setPage(1);
  }

  function changeList(type: ListType) {
    setListType(type);
    setField("");
    setSubfield("");
    setCountry("");
    setPage(1);
  }

  function flushSearch() {
    const next = queryInput.trim();
    setQuery(next);
    setPage(1);
  }

  function chooseScope(next: SearchScope) {
    setScope(next);
    setQuery(queryInput.trim());
    setPage(1);
    setScopeOpen(false);
  }

  const activeFilterCount = [field, subfield, country].filter(Boolean).length;

  return (
    <>
      <header className="hero">
        <div className="hero-inner">
          <div>
            <h1>World&apos;s Top 2% Scientists 2026</h1>
            <p className="hero-intro">
              Search authors and institutions in the official Stanford / Elsevier lists.
            </p>
          </div>
          <div className="hero-mark">
            <img
              className="hero-qr"
              src="./assets/TOP2Scientists.png"
              alt="TOP2% Scientists 2026"
            />
            <a href="#source" className="hero-source">
              Source
            </a>
          </div>
        </div>
      </header>

      <div ref={pinSentinelRef} aria-hidden className="h-0" />
      <section className={`search-panel ${pinned ? "is-pinned" : ""}`}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            flushSearch();
          }}
        >
          <div className="search-wrap">
            <Search size={18} />
            <input
              ref={searchRef}
              value={queryInput}
              onChange={(event) => {
                const next = event.target.value;
                setQueryInput(next);
                const open = next.trim().length > 0;
                setScopeOpen(open);
                if (open) setActiveScope(Math.max(0, searchScopes.indexOf(scope)));
              }}
              onFocus={() => {
                if (!queryInput.trim()) return;
                setScopeOpen(true);
                setActiveScope(Math.max(0, searchScopes.indexOf(scope)));
              }}
              onBlur={() => window.setTimeout(() => setScopeOpen(false), 120)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  if (!scopeOpen) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setScopeOpen(false);
                  return;
                }
                if (!queryInput.trim()) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setScopeOpen(true);
                  setActiveScope((value) => (value + 1) % searchScopes.length);
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setScopeOpen(true);
                  setActiveScope((value) => (value <= 0 ? searchScopes.length - 1 : value - 1));
                }
                if (event.key === "Enter" && scopeOpen) {
                  event.preventDefault();
                  chooseScope(searchScopes[activeScope] ?? scope);
                }
              }}
              placeholder={scopePlaceholders[scope]}
              aria-label="Search scientists"
              aria-expanded={scopeOpen}
              aria-controls="search-scope-menu"
              autoComplete="off"
              autoFocus
            />
            {queryInput && (
              <button
                type="button"
                onClick={() => {
                  setQueryInput("");
                  setQuery("");
                  setScopeOpen(false);
                  searchRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-slate-400 hover:bg-slate-100"
                aria-label="Clear search"
              >
                <X size={16} />
              </button>
            )}
            {scopeOpen && queryInput.trim() && (
              <ul id="search-scope-menu" role="listbox" aria-label="Search in" className="search-scope-menu">
                {searchScopes.map((item, index) => (
                  <li key={item}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={scope === item}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveScope(index)}
                      onClick={() => chooseScope(item)}
                      className={index === activeScope ? "is-active" : ""}
                    >
                      <span>{scopeLabels[item]}</span>
                      <span>{scopePlaceholders[item]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </form>
        {!pinned && (
          <p className="search-meta">
            {stats.dataReady ? (
              <>
                <strong>{formatInteger(stats.totalSingleYear)}</strong> single-year
                <span className="mx-2 text-slate-300">·</span>
                <strong>{formatInteger(stats.totalCareer)}</strong> career
                <span className="mx-2 text-slate-300">·</span>
                <strong>{formatInteger(stats.countries)}</strong> countries
                <span className="mx-2 text-slate-300">·</span>
                <strong>{formatInteger(stats.subfields)}</strong> subfields
              </>
            ) : (
              <span>{dbError ? "Database not loaded" : `${dbPhase}…`}</span>
            )}
          </p>
        )}
      </section>

      <main className="mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-5">
        {dbError && (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            <p>{dbError}</p>
            <p className="mt-1 text-xs text-amber-800/80">
              {window.location.protocol === "file:"
                ? "Open this folder through its website address. A page opened as a local file cannot read the database beside it."
                : "The search index could not be loaded. Publish data/manifest.json, data/index, data/cards, and data/details next to index.html."}
            </p>
          </div>
        )}
        {!dbReady && !dbError && (
          <div className="mb-3 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-3 text-sm text-cyan-950">
            <div className="flex items-center justify-between gap-3">
              <span>{dbPhase}… You can type a name while this finishes.</span>
              <span className="shrink-0 font-semibold tabular-nums">
                {Math.round(dbProgress * 100)}%
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cyan-100">
              <div
                className="h-full rounded-full bg-cyan-600 transition-[width] duration-200"
                style={{ width: `${Math.round(dbProgress * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-cyan-800/80">
              The first page loads a small list. Career-long loads when that list is opened.
            </p>
          </div>
        )}

        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
              {(
                [
                  ["single_year", "2026 single-year"],
                  ["career", "Career-long"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => changeList(value)}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition sm:text-sm ${
                    listType === value
                      ? "bg-white text-slate-950 shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              <span className="rounded-md bg-cyan-50 px-1.5 py-0.5 font-semibold tabular-nums text-cyan-800">
                {formatInteger(result.total)}
              </span>{" "}
              scientists
            </p>
          </div>
          <button
            onClick={() => setShowFilters((value) => !value)}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 lg:hidden"
          >
            <SlidersHorizontal size={15} />
            Filters {activeFilterCount > 0 && `(${activeFilterCount})`}
          </button>
        </div>

        <div
          className={`${showFilters ? "flex" : "hidden"} mb-3 flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 lg:flex lg:flex-row lg:items-end`}
        >
          <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700 lg:mr-1 lg:pb-1.5">
            <Filter size={15} className="text-cyan-600" />
          </div>
          <Select label="Field" value={field} onChange={(value) => { setField(value); setSubfield(""); setPage(1); }}>
            <option value="">All fields</option>
            {filters.fields.map((item) => <option key={item}>{item}</option>)}
          </Select>
          <Select label="Subfield" value={subfield} onChange={(value) => { setSubfield(value); setPage(1); }}>
            <option value="">All subfields</option>
            {filters.subfields.map((item) => <option key={item}>{item}</option>)}
          </Select>
          <Select label="Country/Region" value={country} onChange={(value) => { setCountry(value); setPage(1); }}>
            <option value="">All countries</option>
            {[...filters.countries]
              .sort((left, right) =>
                right.count - left.count
                || countryLabel(left.name).localeCompare(countryLabel(right.name), "en"),
              )
              .map((item) => (
                <option key={item.name} value={item.name}>{countryOptionLabel(item.name)}</option>
              ))}
          </Select>
          <Select label="Sort by" value={sort} onChange={(value) => { setSort(value as SortKey); setPage(1); }}>
            <option value="rank">World rank</option>
            <option value="subfieldRank">Subfield rank</option>
            <option value="cScore">c-score</option>
            <option value="citations">Citations</option>
            <option value="hIndex">h-index</option>
            <option value="name">Author name</option>
          </Select>
          <button
            onClick={() => { setOrder((value) => value === "asc" ? "desc" : "asc"); setPage(1); }}
            className="flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-200 px-2.5 text-sm text-slate-600 transition hover:bg-slate-50"
            title="Toggle sort order"
          >
            <ArrowDownUp size={14} /> {order === "asc" ? "Asc" : "Desc"}
          </button>
          {activeFilterCount > 0 && (
            <button onClick={resetFilters} className="h-9 shrink-0 px-2 text-sm text-cyan-700 hover:text-cyan-900">
              Reset
            </button>
          )}
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-20 px-3 py-2.5">World rank</th>
                  <th className="px-3 py-2.5">Scientist</th>
                  <th className="px-3 py-2.5">Field / subfield</th>
                  <th className="px-3 py-2.5 text-right">Subfield rank</th>
                  <th className="px-3 py-2.5 text-right">Citations</th>
                  <th className="px-3 py-2.5 text-right">h-index</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.items.map((scientist) => (
                  <tr
                    key={scientist.id}
                    onClick={() => openScientist(scientist)}
                    className={`cursor-pointer transition ${
                      selected?.id === scientist.id ? "bg-cyan-50" : "hover:bg-cyan-50/40"
                    }`}
                  >
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-sm font-semibold text-slate-800">
                        #{formatNumber(scientist.rankGlobal)}
                      </span>
                    </td>
                    <td className="max-w-xs px-3 py-2.5">
                      <div className="font-medium text-slate-950">
                        <Highlight text={scientist.name} query={query} />
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        <Highlight text={scientist.affiliation || "—"} query={query} />
                        {" · "}
                        {scientist.country || "—"}
                      </div>
                    </td>
                    <td className="max-w-xs px-3 py-2.5">
                      <div className="truncate text-sm text-slate-700">
                        <Highlight text={scientist.field || "—"} query={query} />
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        <Highlight text={scientist.subfield || "—"} query={query} />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-sm text-slate-700">
                      {formatNumber(scientist.rankSubfield)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-sm text-slate-700">
                      {formatNumber(scientist.citations, true)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-sm font-medium text-slate-800">
                      {formatNumber(scientist.hIndex)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-slate-100 md:hidden">
            {result.items.map((scientist) => (
              <button
                key={scientist.id}
                onClick={() => openScientist(scientist)}
                className={`w-full px-3 py-2.5 text-left transition ${
                  selected?.id === scientist.id ? "bg-cyan-50" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-950">
                      <Highlight text={scientist.name} query={query} />
                    </div>
                    <div className="line-clamp-1 text-xs text-slate-500">
                      <Highlight text={scientist.affiliation || "—"} query={query} />
                    </div>
                  </div>
                  <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-700">
                    #{formatNumber(scientist.rankGlobal)}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                  <span>{scientist.country || "—"}</span>
                  <span>Subfield #{formatNumber(scientist.rankSubfield)}</span>
                  <span>h {formatNumber(scientist.hIndex)}</span>
                </div>
              </button>
            ))}
          </div>

          {loading && (
            <div className="grid min-h-40 place-items-center">
              <div className="text-center text-sm text-slate-500">
                <LoaderCircle className="mx-auto mb-2 animate-spin text-cyan-600" />
                Opening the official 2026 database…
              </div>
            </div>
          )}
          {!loading && result.broad && (
            <div className="grid min-h-40 place-items-center px-4 text-center">
              <div>
                <h3 className="font-medium text-slate-900">Too many institutions</h3>
                <p className="mt-1 text-sm text-slate-500">
                  More than 4,000 scientists match. Add more of the institution name.
                </p>
              </div>
            </div>
          )}
          {!loading && !result.broad && result.items.length === 0 && (
            <div className="grid min-h-40 place-items-center px-4 text-center">
              <div>
                <div className="mx-auto grid size-10 place-items-center rounded-full bg-slate-100 text-slate-400">
                  <Search size={18} />
                </div>
                <h3 className="mt-3 font-medium text-slate-900">No matching records</h3>
                <p className="mt-1 text-sm text-slate-500">Try a shorter keyword or clear the filters.</p>
              </div>
            </div>
          )}

          {!loading && result.pageCount > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2.5">
              <span className="text-xs text-slate-500">
                Page {result.page} / {formatInteger(result.pageCount)}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  className="rounded-lg border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label="Previous page"
                >
                  <ChevronLeft size={17} />
                </button>
                <button
                  disabled={page >= result.pageCount}
                  onClick={() => setPage((value) => value + 1)}
                  className="rounded-lg border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label="Next page"
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </div>
          )}
        </div>

      </main>

      <footer
        id="source"
        className="flex justify-center border-t border-slate-200 bg-white px-4 py-4"
      >
        <p className="text-center text-[13px] leading-[1.45] text-[#4b5563]">
          The data is verified and sourced from{" "}
          <span className="font-semibold text-[#e85a2a]">ELSEVIER</span> and{" "}
          <span className="font-semibold text-[#8C1515]">Stanford University</span>
          &apos;s Top 2% Scientists list.
        </p>
      </footer>

      {selected && <DetailPanel scientist={selected} onClose={closeScientist} />}
    </>
  );
}
