#!/usr/bin/env python3
"""Build a fast, searchable NeurIPS paper portal from the legacy index."""

from __future__ import annotations

import html
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "data" / "source-index.html"
INDEX = ROOT / "index.html"
DATA_DIR = ROOT / "paper-data"
SHARD_SIZE = 100

TAG_RE = re.compile(r"<[^>]+>")
RECORD_RE = re.compile(
    r"<div id='section'>PaperID:\s*<span id='pid'>(\d+),\s*</span>"
    r"(.*?)<div id = 'author'>Authors:&nbsp;<span id = 'author'>(.*?)</span></div>"
    r"<div id=\"title\">Title:&nbsp;<a href=\"([^\"]+)\">(.*?)</a>.*?"
    r"<div id = 'abs'>Abstract: </br> <span id = 'abs'>(.*?)</span>",
    re.I | re.S,
)


def clean(value: str) -> str:
    value = TAG_RE.sub("", value)
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def parse_papers(source: str) -> list[dict]:
    papers: list[dict] = []
    for match in RECORD_RE.finditer(source):
        paper_id = int(match.group(1))
        section, authors_html, openreview, title_html, abstract_html = match.groups()[1:]
        presentation_match = re.search(r">(Oral|Poster)<", section, re.I)
        presentation = presentation_match.group(1).title() if presentation_match else "Other"
        links = [
            (html.unescape(url), clean(label))
            for url, label in re.findall(
                r"<a href=['\"]([^'\"]+)['\"][^>]*>(.*?)</a>", section, re.I | re.S
            )
        ]
        arxiv = next((url for url, _ in links if "arxiv.org/abs/" in url), None)
        pdf = next(
            (
                url
                for url, label in links
                if "arxiv.org/pdf/" in url or label.upper() == "PDF"
            ),
            None,
        )
        code_urls: list[str] = []
        for url, label in links:
            if url in (arxiv, pdf):
                continue
            if label.lower() == "github" or any(
                host in url.lower()
                for host in ("github.com/", "github.io/", "4open.science/")
            ):
                if url not in code_urls:
                    code_urls.append(url)
        abstract = clean(abstract_html)
        for raw_url in re.findall(r"https?://[^\s)]+", abstract):
            url = raw_url.rstrip(".,;")
            if any(
                host in url.lower()
                for host in ("github.com/", "github.io/", "4open.science/")
            ) and url not in code_urls:
                code_urls.append(url)
        papers.append(
            {
                "id": paper_id,
                "presentation": presentation,
                "title": clean(title_html),
                "authors": clean(authors_html),
                "openreview": html.unescape(openreview),
                "arxiv": arxiv,
                "pdf": pdf,
                "code": code_urls,
                "abstract": abstract,
            }
        )
    return papers


def js_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace(
        "</", "<\\/"
    )


def write_data(papers: list[dict]) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    for stale in DATA_DIR.glob("abstracts-*.js"):
        stale.unlink()

    compact = []
    for order, paper in enumerate(papers):
        shard = order // SHARD_SIZE
        compact.append(
            [
                paper["id"],
                paper["presentation"][0],
                paper["title"],
                paper["authors"],
                paper["openreview"],
                paper["arxiv"],
                paper["pdf"],
                paper["code"],
                shard,
            ]
        )
    metadata = {
        "total": len(papers),
        "oral": sum(p["presentation"] == "Oral" for p in papers),
        "poster": sum(p["presentation"] == "Poster" for p in papers),
        "shards": (len(papers) + SHARD_SIZE - 1) // SHARD_SIZE,
        "shardSize": SHARD_SIZE,
    }
    index_js = (
        "window.PAPER_PORTAL_DATA="
        + js_json({"meta": metadata, "papers": compact})
        + ";\n"
    )
    (DATA_DIR / "papers-index.js").write_text(index_js, encoding="utf-8")

    worker_js = f"""\
"use strict";
const TOTAL_SHARDS={metadata["shards"]};
const abstracts=new Map();
let loaded=false;
globalThis.__paperAbstractShard=(_shard,data)=>{{
  for(const [id,text] of Object.entries(data)) abstracts.set(Number(id),text);
}};
const normalize=value=>String(value||"").normalize("NFKD").toLocaleLowerCase();
const terms=query=>normalize(query).match(/"[^"]+"|\\S+/g)?.map(x=>x.replace(/^"|"$/g,""))||[];
function loadAll(){{
  if(loaded) return;
  for(let shard=0;shard<TOTAL_SHARDS;shard++){{
    importScripts(`abstracts-${{String(shard).padStart(3,"0")}}.js`);
    postMessage({{type:"progress",loaded:shard+1,total:TOTAL_SHARDS}});
  }}
  loaded=true;
}}
onmessage=event=>{{
  if(event.data.type!=="search") return;
  const requestId=event.data.requestId;
  try{{
    loadAll();
    const queryTerms=terms(event.data.query);
    const ids=[];
    for(const [id,abstract] of abstracts){{
      const haystack=normalize(abstract);
      if(queryTerms.every(term=>haystack.includes(term))) ids.push(id);
    }}
    postMessage({{type:"results",requestId,ids}});
  }}catch(error){{
    postMessage({{type:"error",requestId,message:String(error)}});
  }}
}};
"""
    (DATA_DIR / "abstract-search-worker.js").write_text(
        worker_js, encoding="utf-8"
    )

    for shard in range(metadata["shards"]):
        group = papers[shard * SHARD_SIZE : (shard + 1) * SHARD_SIZE]
        abstracts = {str(paper["id"]): paper["abstract"] for paper in group}
        content = (
            f"globalThis.__paperAbstractShard&&globalThis.__paperAbstractShard({shard},"
            f"{js_json(abstracts)});\n"
        )
        (DATA_DIR / f"abstracts-{shard:03d}.js").write_text(
            content, encoding="utf-8"
        )


PAGE = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Search NeurIPS 2026 papers by title, author, Paper ID, and abstract">
  <title>NeurIPS 2026 Paper Explorer</title>
  <style>
    :root{--bg:#f5f7fb;--panel:#fff;--ink:#152033;--muted:#657086;--line:#e3e8f1;--brand:#3558d4;--brand2:#6846c7;--soft:#edf2ff;--green:#18794e;--shadow:0 10px 35px rgba(25,38,75,.09)}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:linear-gradient(145deg,#f8faff,#f4f7fb 48%,#f5faf8);color:var(--ink);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
    button,input,select{font:inherit}.hero{background:linear-gradient(120deg,#152759,#3558d4 58%,#6846c7);color:#fff;padding:42px 22px 82px}.hero-inner,main,.footer{max-width:1240px;margin:auto}.hero-inner{position:relative}.hero-star{position:absolute;top:2px;right:0;min-height:28px}.hero-star>a{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border:1px solid rgba(255,255,255,.45);border-radius:8px;background:rgba(255,255,255,.12);color:#fff;font-size:13px;font-weight:700;text-decoration:none}.hero-star>a:hover{background:rgba(255,255,255,.22)}
    .eyebrow{font-weight:700;letter-spacing:.12em;color:#cdd9ff;text-transform:uppercase}.hero h1{margin:5px 0 8px;font-size:clamp(30px,5vw,48px);line-height:1.15}.hero p{margin:0;color:#dfe6ff;font-size:16px}
    main{margin-top:-52px;padding:0 18px 48px}.search-panel{position:sticky;top:0;z-index:8;padding:16px;background:rgba(255,255,255,.95);backdrop-filter:blur(14px);border:1px solid rgba(227,232,241,.9);border-radius:18px;box-shadow:var(--shadow)}
    .search-row{display:grid;grid-template-columns:minmax(260px,1fr) 170px 160px;gap:10px}.search-wrap{position:relative}.search-wrap span{position:absolute;left:13px;top:10px;color:#8b95a8}.search-wrap input{padding-left:38px}
    input,select{width:100%;height:44px;padding:0 12px;border:1px solid var(--line);border-radius:11px;background:#fff;color:var(--ink);outline:none}input:focus,select:focus{border-color:var(--brand);box-shadow:0 0 0 3px rgba(53,88,212,.12)}
    .filter-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:12px}.filter-row label{display:flex;align-items:center;gap:6px;color:#48536a}.filter-row input{width:auto;height:auto}.divider{width:1px;height:22px;background:var(--line);margin:0 3px}.clear-btn{margin-left:auto;border:0;background:transparent;color:var(--brand);cursor:pointer;font-weight:650}
    .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:16px 0}.stat{padding:12px 15px;background:rgba(255,255,255,.82);border:1px solid var(--line);border-radius:13px}.stat b{display:block;font-size:22px;line-height:1.2}.stat span{font-size:12px;color:var(--muted)}
    .status{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:20px 2px 11px;color:var(--muted)}.status strong{color:var(--ink)}.loading{display:none;color:var(--brand);font-weight:650}.loading.show{display:inline}
    .papers{display:grid;gap:12px}.paper{contain:content;background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:18px 20px;box-shadow:0 3px 14px rgba(28,40,75,.035)}.paper:hover{border-color:#cad4ef;box-shadow:0 8px 25px rgba(28,40,75,.075)}
    .paper-top{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:7px}.tag{display:inline-flex;align-items:center;padding:2px 9px;border-radius:999px;background:var(--soft);color:#38549f;font-size:12px;font-weight:700}.tag.poster{background:#ecf8f1;color:var(--green)}.tag.oral{background:#fff0ea;color:#b54708}
    .paper h2{margin:0;font-size:19px;line-height:1.4}.paper h2 a{color:inherit;text-decoration:none}.paper h2 a:hover{color:var(--brand)}mark{padding:0 2px;border-radius:3px;background:#fff0a8;color:inherit}.authors{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}.author-chip{padding:2px 7px;border:0;border-radius:7px;background:#f3f5f9;color:#4f5a70;cursor:pointer}.author-chip:hover,.author-chip:focus-visible{background:#e5ebfa;color:#294ca8;outline:none}.links{display:flex;gap:7px;flex-wrap:wrap;margin-top:11px}.links a,.abstract-btn{padding:4px 9px;border:1px solid #d7dff1;border-radius:8px;background:#f9faff;color:#3554a0;text-decoration:none;font-size:12px;font-weight:700;cursor:pointer}.links a:hover,.abstract-btn:hover{background:var(--brand);border-color:var(--brand);color:#fff}
    .abstract{display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--line);color:#3f4a60;text-align:justify}.abstract.open{display:block}.abstract p{margin:0}.abstract .placeholder{color:var(--muted)}
    .pagination{display:flex;justify-content:center;align-items:center;gap:7px;flex-wrap:wrap;margin:22px 0}.pagination button{min-width:38px;height:38px;border:1px solid var(--line);border-radius:9px;background:#fff;color:#40506b;cursor:pointer}.pagination button.active{background:var(--brand);border-color:var(--brand);color:#fff}.pagination button:disabled{opacity:.42;cursor:not-allowed}
    .empty{padding:55px 20px;text-align:center;background:#fff;border:1px solid var(--line);border-radius:15px;color:var(--muted)}.footer{padding:0 20px 34px;color:var(--muted);font-size:13px}.footer a{color:var(--brand);font-weight:650;text-decoration:none}.footer a:hover{text-decoration:underline}
    .noscript{margin:20px;padding:20px;background:#fff4e8;border:1px solid #ffd9ad;border-radius:12px}
    @media(max-width:760px){.hero{padding-top:30px}.hero-star{position:static;margin-bottom:12px}.search-row{grid-template-columns:1fr}.search-panel{position:relative}.stats{grid-template-columns:1fr 1fr}.paper{padding:15px}.status{align-items:flex-start;flex-direction:column}.clear-btn{margin-left:0}.divider{display:none}}
  </style>
</head>
<body>
  <header class="hero"><div class="hero-inner"><div class="hero-star"><a class="github-button" href="https://github.com/csgaobb/csgaobb.github.io" data-icon="octicon-star" data-size="large" data-show-count="true" aria-label="Star csgaobb/csgaobb.github.io on GitHub">Star</a></div><div class="eyebrow" data-i18n="eyebrow">Paper Explorer</div><h1 data-i18n="heading">NeurIPS 2026 Paper Search</h1><p data-i18n="intro">Search titles, authors, Paper IDs, and abstracts. Abstracts load on demand for a fast initial page.</p></div></header>
  <main>
    <section class="search-panel" aria-label="Search and filters">
      <div class="search-row">
        <div class="search-wrap"><span>⌕</span><input id="query" type="search" placeholder="Enter keywords (spaces mean AND)" data-i18n-placeholder="searchPlaceholder" autocomplete="off"></div>
        <select id="field" aria-label="Search field"><option value="basic" data-i18n="fieldBasic">Title, author, or ID</option><option value="title" data-i18n="fieldTitle">Title only</option><option value="authors" data-i18n="fieldAuthors">Author only</option><option value="id" data-i18n="fieldId">Paper ID only</option><option value="abstract" data-i18n="fieldAbstract">Full abstract</option></select>
        <select id="sort" aria-label="Sort order"><option value="id" data-i18n="sortId">Paper ID ascending</option><option value="id-desc" data-i18n="sortIdDesc">Paper ID descending</option><option value="title" data-i18n="sortTitle">Title A–Z</option></select>
      </div>
      <div class="filter-row">
        <label><input type="checkbox" name="type" value="O" checked> Oral</label>
        <label><input type="checkbox" name="type" value="P" checked> Poster</label><span class="divider"></span>
        <label><input id="hasArxiv" type="checkbox"> <span data-i18n="hasArxiv">Has arXiv</span></label>
        <label><input id="hasCode" type="checkbox"> <span data-i18n="hasCode">Has code</span></label><span class="divider"></span>
        <label><span data-i18n="perPage">Per page</span> <select id="pageSize" style="width:76px;height:34px"><option>30</option><option selected>60</option><option>120</option></select></label>
        <button class="clear-btn" id="clear" type="button" data-i18n="clearFilters">Clear filters</button>
      </div>
    </section>
    <section class="stats" aria-label="Paper statistics"><div class="stat"><b id="total">—</b><span data-i18n="allPapers">All papers</span></div><div class="stat"><b id="oral">—</b><span>Oral</span></div><div class="stat"><b id="poster">—</b><span>Poster</span></div><div class="stat"><b id="arxivCount">—</b><span data-i18n="withArxiv">With arXiv</span></div><div class="stat"><b id="codeCount">—</b><span data-i18n="withCode">With code</span></div></section>
    <div class="status"><div><strong id="resultCount" data-i18n="loadingIndex">Loading paper index…</strong> <span id="queryHint"></span></div><span class="loading" id="loading"><span data-i18n="loadingAbstractIndex">Loading abstract index…</span> <span id="progress"></span></span></div>
    <section id="papers" class="papers" aria-live="polite"></section><nav id="pagination" class="pagination" aria-label="Pagination"></nav>
  </main>
  <footer class="footer"><span data-i18n="dataSource">Data source:</span> <a href="https://github.com/hongsong-wang/NeurIPS2026" target="_blank" rel="noopener noreferrer">hongsong-wang/NeurIPS2026</a>. <span data-i18n="footerNote">“View abstract” loads only the relevant 100-paper shard; full-abstract search runs in a background worker.</span></footer>
  <noscript><div class="noscript">This paper explorer requires JavaScript.</div></noscript>
  <script defer src="paper-data/papers-index.js"></script>
  <script async defer src="https://buttons.github.io/buttons.js"></script>
  <script>
  (() => {
    "use strict";
    const MESSAGES = {
      en: {
        eyebrow: "Paper Explorer",
        heading: "NeurIPS 2026 Paper Search",
        intro: "Search titles, authors, Paper IDs, and abstracts. Abstracts load on demand for a fast initial page.",
        searchPlaceholder: "Enter keywords (spaces mean AND)",
        fieldBasic: "Title, author, or ID", fieldTitle: "Title only",
        fieldAuthors: "Author only", fieldId: "Paper ID only",
        fieldAbstract: "Full abstract", sortId: "Paper ID ascending",
        sortIdDesc: "Paper ID descending", sortTitle: "Title A–Z",
        hasArxiv: "Has arXiv", hasCode: "Has code", perPage: "Per page",
        clearFilters: "Clear filters", allPapers: "All papers",
        withArxiv: "With arXiv", withCode: "With code",
        loadingIndex: "Loading paper index…",
        loadingAbstractIndex: "Searching abstracts in a background worker…",
        papersFound: "{count} papers found",
        keywordsMatch: "· all {count} keywords must match",
        code: "Code", viewAbstract: "View abstract", hideAbstract: "Hide abstract",
        loading: "Loading…", noAbstract: "No abstract is available in the source data.",
        abstractError: "Could not load the abstract. Refresh the page and try again.",
        noResults: "No papers match your search. Try fewer keywords or clear the filters.",
        dataSource: "Data source:",
        footerNote: "“View abstract” loads only the relevant 100-paper shard; full-abstract search runs in a background worker."
      }
    };
    const locale = "en";
    const $ = id => document.getElementById(id);
    const t = (key, values = {}) => {
      let text = MESSAGES[locale][key] || key;
      for (const [name, value] of Object.entries(values)) text = text.replace(`{${name}}`, value);
      return text;
    };
    document.querySelectorAll("[data-i18n]").forEach(el => el.textContent = t(el.dataset.i18n));
    document.querySelectorAll("[data-i18n-placeholder]").forEach(el => el.placeholder = t(el.dataset.i18nPlaceholder));

    const state = {
      query: "", field: "basic", sort: "id", types: new Set(["O", "P"]),
      arxiv: false, code: false, page: 1, pageSize: 60, exactAuthor: ""
    };
    const abstractCache = new Map(), loadedShards = new Set(), shardPromises = new Map();
    let papers = [], filtered = [], debounceTimer, abstractWorker, abstractRequest = 0;
    let abstractMatches = null;

    globalThis.__paperAbstractShard = (shard, data) => {
      Object.entries(data).forEach(([id, text]) => abstractCache.set(Number(id), text));
      loadedShards.add(shard);
    };
    function loadShard(shard) {
      if (loadedShards.has(shard)) return Promise.resolve();
      if (shardPromises.has(shard)) return shardPromises.get(shard);
      const promise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = `paper-data/abstracts-${String(shard).padStart(3, "0")}.js`;
        script.onload = () => { loadedShards.add(shard); resolve(); };
        script.onerror = reject;
        document.head.appendChild(script);
      });
      shardPromises.set(shard, promise);
      return promise;
    }
    async function searchAbstractsFallback(query, requestId) {
      $("loading").classList.add("show");
      try {
        const total = globalThis.PAPER_PORTAL_DATA.meta.shards;
        const queue = Array.from({length:total}, (_,i) => i);
        let completed = 0;
        const loader = async () => {
          while (queue.length) {
            await loadShard(queue.shift());
            $("progress").textContent = `${++completed}/${total}`;
          }
        };
        await Promise.all(Array.from({length:Math.min(8,total)}, loader));
        if (requestId !== abstractRequest) return new Set();
        const needles = queryTerms(query);
        return new Set([...abstractCache].filter(([,text]) => {
          const haystack = normalize(text);
          return needles.every(term => haystack.includes(term));
        }).map(([id]) => id));
      } finally {
        if (requestId === abstractRequest) $("loading").classList.remove("show");
      }
    }
    function searchAbstracts(query, requestId) {
      if (!abstractWorker) {
        try { abstractWorker = new Worker("paper-data/abstract-search-worker.js"); }
        catch { return searchAbstractsFallback(query, requestId); }
        abstractWorker.onmessage = event => {
          if (event.data.type === "progress") {
            $("progress").textContent = `${event.data.loaded}/${event.data.total}`;
          }
        };
      }
      $("loading").classList.add("show");
      return new Promise((resolve, reject) => {
        const listener = event => {
          if (event.data.requestId !== requestId) return;
          if (event.data.type === "results") {
            abstractWorker.removeEventListener("message", listener);
            resolve(new Set(event.data.ids));
          } else if (event.data.type === "error") {
            abstractWorker.removeEventListener("message", listener);
            reject(new Error(event.data.message));
          }
        };
        abstractWorker.addEventListener("message", listener);
        abstractWorker.postMessage({type: "search", requestId, query});
      }).finally(() => {
        if (requestId === abstractRequest) $("loading").classList.remove("show");
      });
    }

    const normalize = value => String(value || "").normalize("NFKD").toLocaleLowerCase();
    const queryTerms = query => normalize(query).match(/"[^"]+"|\S+/g)?.map(x => x.replace(/^"|"$/g, "")) || [];
    const rawTerms = query => String(query || "").match(/"[^"]+"|\S+/g)?.map(x => x.replace(/^"|"$/g, "")) || [];
    const esc = value => String(value).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
    const regexEsc = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    function authorMatchesQuery(author, query) {
      if (!query) return true;
      return new RegExp(`(^|\\s)${regexEsc(query)}(?=\\s|$)`).test(author);
    }
    function highlight(value, enabled) {
      const safe = esc(value);
      const needles = enabled ? rawTerms(state.query).filter(Boolean).map(v => regexEsc(esc(v))) : [];
      return needles.length ? safe.replace(new RegExp(`(${needles.join("|")})`, "gi"), "<mark>$1</mark>") : safe;
    }

    function restoreStateFromURL() {
      const params = new URLSearchParams(location.search);
      state.query = params.get("q") || "";
      state.field = ["basic","title","authors","id","abstract"].includes(params.get("field")) ? params.get("field") : "basic";
      state.sort = ["id","id-desc","title"].includes(params.get("sort")) ? params.get("sort") : "id";
      state.arxiv = params.get("arxiv") === "1";
      state.code = params.get("code") === "1";
      state.page = Math.max(1, Number(params.get("page")) || 1);
      state.pageSize = [30,60,120].includes(Number(params.get("size"))) ? Number(params.get("size")) : 60;
      state.exactAuthor = params.get("author") || "";
      if (state.exactAuthor) { state.query = state.exactAuthor; state.field = "authors"; }
      const type = params.get("type");
      state.types = type === "O" ? new Set(["O"]) : type === "P" ? new Set(["P"]) : type === "none" ? new Set() : new Set(["O","P"]);
    }
    function syncControls() {
      $("query").value = state.query; $("field").value = state.field; $("sort").value = state.sort;
      $("hasArxiv").checked = state.arxiv; $("hasCode").checked = state.code;
      $("pageSize").value = String(state.pageSize);
      document.querySelectorAll('input[name="type"]').forEach(c => c.checked = state.types.has(c.value));
    }
    function writeURL(mode = "replace") {
      const params = new URLSearchParams();
      if (state.exactAuthor) params.set("author", state.exactAuthor);
      else if (state.query) params.set("q", state.query);
      if (state.field !== "basic" && !state.exactAuthor) params.set("field", state.field);
      if (state.sort !== "id") params.set("sort", state.sort);
      if (state.types.size !== 2) params.set("type", state.types.size === 0 ? "none" : [...state.types][0]);
      if (state.arxiv) params.set("arxiv", "1");
      if (state.code) params.set("code", "1");
      if (state.page !== 1) params.set("page", state.page);
      if (state.pageSize !== 60) params.set("size", state.pageSize);
      const search = params.toString();
      const url = `${location.pathname}${search ? `?${search}` : ""}${location.hash}`;
      history[mode === "push" ? "pushState" : "replaceState"]({}, "", url);
    }

    function hydrate() {
      const data = globalThis.PAPER_PORTAL_DATA, meta = data.meta;
      papers = data.papers.map((p, order) => {
        const authorList = p[3].split(",").map(name => name.trim()).filter(Boolean);
        return {
          id:p[0], type:p[1], title:p[2], authors:p[3], authorList,
          normalizedAuthors:authorList.map(normalize), openreview:p[4], arxiv:p[5],
          pdf:p[6], code:p[7] || [], shard:p[8], order,
          searchBasic:normalize(`${p[0]} ${p[2]} ${p[3]}`),
          searchTitle:normalize(p[2]), searchAuthors:normalize(p[3])
        };
      });
      $("total").textContent = meta.total.toLocaleString();
      $("oral").textContent = meta.oral.toLocaleString();
      $("poster").textContent = meta.poster.toLocaleString();
      $("arxivCount").textContent = papers.filter(p => p.arxiv).length.toLocaleString();
      $("codeCount").textContent = papers.filter(p => p.code.length).length.toLocaleString();
      restoreStateFromURL(); syncControls(); runSearch(false);
    }
    function searchable(p) {
      if (state.field === "title") return p.searchTitle;
      if (state.field === "authors") return p.searchAuthors;
      if (state.field === "id") return String(p.id);
      return p.searchBasic;
    }
    function applyFilters(write = true) {
      const terms = queryTerms(state.query), exact = normalize(state.exactAuthor);
      filtered = papers.filter(p => {
        let textMatch;
        if (state.field === "abstract") {
          textMatch = !terms.length || abstractMatches?.has(p.id);
        } else if (state.field === "authors") {
          const authorQuery = normalize(state.query).trim().replace(/^"|"$/g, "");
          textMatch = p.normalizedAuthors.some(author => authorMatchesQuery(author, authorQuery));
        } else {
          textMatch = terms.every(term => searchable(p).includes(term));
        }
        return state.types.has(p.type) && (!state.arxiv || p.arxiv) &&
          (!state.code || p.code.length) && (!exact || p.normalizedAuthors.includes(exact)) && textMatch;
      });
      if (state.sort === "id-desc") filtered.sort((a,b) => b.id-a.id);
      else if (state.sort === "title") filtered.sort((a,b) => a.title.localeCompare(b.title));
      else filtered.sort((a,b) => a.id-b.id);
      state.page = Math.min(state.page, Math.max(1, Math.ceil(filtered.length/state.pageSize)));
      $("resultCount").textContent = t("papersFound", {count: filtered.length.toLocaleString()});
      $("queryHint").textContent = terms.length ? t("keywordsMatch", {count: terms.length}) : "";
      render();
      if (write) writeURL();
    }
    function card(p) {
      const resources = [
        `<a href="${esc(p.openreview)}" target="_blank" rel="noopener">OpenReview</a>`,
        p.arxiv && `<a href="${esc(p.arxiv)}" target="_blank" rel="noopener">arXiv</a>`,
        p.pdf && `<a href="${esc(p.pdf)}" target="_blank" rel="noopener">PDF</a>`,
        ...p.code.map((url,i) => `<a href="${esc(url)}" target="_blank" rel="noopener">${t("code")}${p.code.length>1 ? ` ${i+1}` : ""}</a>`)
      ].filter(Boolean).join("");
      const title = highlight(p.title, state.field === "basic" || state.field === "title");
      const authorQuery = normalize(state.query).trim().replace(/^"|"$/g, "");
      const authors = p.authorList.map(name => {
        const matchedAuthor = state.field === "authors" && authorMatchesQuery(normalize(name), authorQuery);
        return `<button class="author-chip" data-author="${esc(name)}">${highlight(name, state.field === "basic" || matchedAuthor)}</button>`;
      }).join("");
      return `<article class="paper"><div class="paper-top"><span class="tag">Paper ${p.id}</span><span class="tag ${p.type==="O"?"oral":"poster"}">${p.type==="O"?"Oral":"Poster"}</span></div><h2><a href="${esc(p.openreview)}" target="_blank" rel="noopener">${title}</a></h2><div class="authors">${authors}</div><div class="links">${resources}<button class="abstract-btn" data-id="${p.id}" data-shard="${p.shard}" aria-expanded="false" aria-controls="abstract-${p.id}">${t("viewAbstract")}</button></div><div class="abstract" id="abstract-${p.id}"><p class="placeholder">${t("loading")}</p></div></article>`;
    }
    function render() {
      const start = (state.page-1)*state.pageSize, visible = filtered.slice(start,start+state.pageSize);
      $("papers").innerHTML = visible.length ? visible.map(card).join("") : `<div class="empty">${t("noResults")}</div>`;
      renderPagination();
    }
    async function toggleAbstract(button) {
      const box = $(`abstract-${button.dataset.id}`), opening = !box.classList.contains("open");
      box.classList.toggle("open", opening); button.setAttribute("aria-expanded", String(opening));
      button.textContent = opening ? t("hideAbstract") : t("viewAbstract");
      if (!opening || box.dataset.ready) return;
      try {
        await loadShard(Number(button.dataset.shard));
        box.innerHTML = `<p>${esc(abstractCache.get(Number(button.dataset.id)) || t("noAbstract"))}</p>`;
        box.dataset.ready = "1";
      } catch { box.innerHTML = `<p class="placeholder">${t("abstractError")}</p>`; }
    }
    function renderPagination() {
      const pages = Math.max(1,Math.ceil(filtered.length/state.pageSize)), nav = $("pagination");
      if (pages <= 1) { nav.innerHTML = ""; return; }
      const nums = new Set([1,pages,state.page-1,state.page,state.page+1]);
      const sorted = [...nums].filter(n => n>=1 && n<=pages).sort((a,b) => a-b);
      let last=0, html=`<button data-page="${state.page-1}" ${state.page===1?"disabled":""}>‹</button>`;
      for (const n of sorted) {
        if (last && n-last>1) html += "<span>…</span>";
        html += `<button data-page="${n}" class="${n===state.page?"active":""}">${n}</button>`; last=n;
      }
      html += `<button data-page="${state.page+1}" ${state.page===pages?"disabled":""}>›</button>`;
      nav.innerHTML = html;
    }
    async function runSearch(write = true) {
      const request = ++abstractRequest;
      if (state.field === "abstract" && state.query.trim()) {
        try { abstractMatches = await searchAbstracts(state.query, request); }
        catch { abstractMatches = new Set(); }
        if (request !== abstractRequest) return;
      } else { abstractMatches = null; }
      applyFilters(write);
    }
    function readControls() {
      state.query = $("query").value; state.field = $("field").value;
      state.sort = $("sort").value; state.arxiv = $("hasArxiv").checked;
      state.code = $("hasCode").checked; state.pageSize = Number($("pageSize").value);
      state.types = new Set([...document.querySelectorAll('input[name="type"]:checked')].map(x => x.value));
    }
    function controlsChanged(clearAuthor = false) {
      readControls(); if (clearAuthor) state.exactAuthor = ""; state.page = 1; runSearch();
    }
    $("query").addEventListener("input", () => { clearTimeout(debounceTimer); debounceTimer=setTimeout(() => controlsChanged(true),140); });
    $("field").addEventListener("change", () => controlsChanged(true));
    $("sort").addEventListener("change", () => controlsChanged());
    $("pageSize").addEventListener("change", () => controlsChanged());
    document.querySelectorAll('input[name="type"]').forEach(c => c.addEventListener("change", () => controlsChanged()));
    $("hasArxiv").addEventListener("change", () => controlsChanged());
    $("hasCode").addEventListener("change", () => controlsChanged());
    $("papers").addEventListener("click", event => {
      const abstractButton = event.target.closest(".abstract-btn");
      if (abstractButton) { toggleAbstract(abstractButton); return; }
      const authorButton = event.target.closest(".author-chip");
      if (authorButton) {
        state.exactAuthor = authorButton.dataset.author; state.query = state.exactAuthor;
        state.field = "authors"; state.page = 1; syncControls(); applyFilters(false); writeURL("push");
      }
    });
    $("pagination").addEventListener("click", event => {
      const button = event.target.closest("button[data-page]");
      if (!button || button.disabled) return;
      state.page = Number(button.dataset.page); render(); writeURL("push");
      scrollTo({top:document.querySelector(".status").offsetTop-90,behavior:"smooth"});
    });
    $("clear").addEventListener("click", () => {
      Object.assign(state,{query:"",field:"basic",sort:"id",types:new Set(["O","P"]),arxiv:false,code:false,page:1,pageSize:60,exactAuthor:""});
      abstractMatches=null; syncControls(); applyFilters();
    });
    addEventListener("popstate", () => { restoreStateFromURL(); syncControls(); runSearch(false); });
    document.addEventListener("keydown", event => {
      if (event.key === "/" && !/input|select|textarea/i.test(document.activeElement.tagName)) {
        event.preventDefault(); $("query").focus();
      }
    });
    const wait = () => globalThis.PAPER_PORTAL_DATA ? hydrate() : setTimeout(wait,20);
    wait();
  })();
  </script>
</body>
</html>
"""


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(f"Source dataset not found: {SOURCE}")
    source = SOURCE.read_text(encoding="utf-8", errors="ignore")
    papers = parse_papers(source)
    if len(papers) < 100:
        raise RuntimeError(f"Only parsed {len(papers)} papers; refusing to overwrite index")
    write_data(papers)
    INDEX.write_text(PAGE, encoding="utf-8")
    print(
        f"Built {len(papers)} papers, "
        f"{(len(papers) + SHARD_SIZE - 1) // SHARD_SIZE} abstract shards"
    )


if __name__ == "__main__":
    main()
