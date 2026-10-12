import { Camera, GraduationCap, User, X } from "../lib/icons";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { countryFlag, countryLabel } from "../lib/country-flag";
import { scientistPermalink } from "../lib/permalink";
import type { ScientistRecord } from "../lib/types";

function formatRank(value: number | null) {
  if (value === null || value === undefined) return "—";
  return Math.round(value).toString();
}

function formatIndex(value: number | null) {
  if (value === null || value === undefined) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatCount(value: number | null) {
  if (value === null || value === undefined) return "—";
  return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatShare(rank: number, total: number) {
  const percent = (rank / total) * 100;
  if (!Number.isFinite(percent) || percent <= 0) return "";
  return `${percent.toFixed(2)}%`;
}

function formatSubfieldRank(rank: number | null, total: number | null) {
  if (!total) return formatCount(rank);
  const share = rank ? formatShare(rank, total) : "";
  const ratio = `${formatCount(rank)} / ${formatCount(total)}`;
  return share ? `${ratio} (${share})` : ratio;
}

function formatPercent(value: number | null) {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(2)}%`;
}

function formatRatio(value: number | null) {
  if (value === null || value === undefined) return "—";
  return value.toFixed(2);
}

function MetricRow({
  label,
  excluded,
  all,
}: {
  label: string;
  excluded: string;
  all: string;
}) {
  return (
    <tr className="border-t border-slate-100">
      <th className="py-2 pr-3 text-left text-[12px] font-medium text-slate-600">{label}</th>
      <td className="py-2 px-2 text-right text-[13px] tabular-nums text-[#152033]">{excluded}</td>
      <td className="py-2 pl-2 text-right text-[13px] tabular-nums text-[#152033]">{all}</td>
    </tr>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium leading-4 text-slate-500">{label}</p>
      <p className="mt-1 text-[18px] font-semibold leading-none tabular-nums text-[#152033]">
        {value}
      </p>
    </div>
  );
}

function FactLabel({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="font-semibold text-[#1d4ed8]">{label}:</span>{" "}
      <span className="text-black">{value}</span>
    </>
  );
}

function Fact({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-[15px] leading-6">
      <span
        aria-hidden
        className="mt-[7px] size-2 shrink-0 rounded-full border-[2px] border-[#2b7de9]"
      />
      <p className="whitespace-nowrap">{children}</p>
    </div>
  );
}

function photoKey(scientist: ScientistRecord) {
  const id = scientist.scopusId || scientist.id;
  return `top2scientists-photo:${id}`;
}

function readStoredPhoto(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredPhoto(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // ignore quota / private mode
  }
}

function resizePhoto(file: File) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const size = 320;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context || image.width < 1 || image.height < 1) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("canvas"));
        return;
      }
      const side = Math.min(image.width, image.height);
      const sourceX = (image.width - side) / 2;
      const sourceY = 0;
      context.beginPath();
      context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      context.closePath();
      context.clip();
      context.drawImage(image, sourceX, sourceY, side, side, 0, 0, size, size);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("image"));
    };
    image.src = objectUrl;
  });
}

function Top2Mark() {
  return (
    <div className="flex size-[68px] shrink-0 flex-col items-center justify-center rounded-full border-[1.5px] border-black text-center text-black">
      <GraduationCap size={16} strokeWidth={2} className="mb-0.5" />
      <div className="text-[11px] font-extrabold leading-none tracking-tight">TOP2%</div>
      <div className="mt-1 text-[8px] font-bold leading-none tracking-[0.08em]">
        SCIENTISTS
      </div>
    </div>
  );
}

function ScientistCertificate({ scientist }: { scientist: ScientistRecord }) {
  const [qr, setQr] = useState("");
  const url = scientistPermalink(scientist.id);
  const flag = countryFlag(scientist.country);
  const country = countryLabel(scientist.country);
  const listLabel = scientist.listType === "career" ? "Career-long" : "Single-year";
  const storageKey = photoKey(scientist);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => {
    const stored = readStoredPhoto(storageKey);
    if (stored) {
      setPhoto(stored);
      return;
    }
    const legacy = readStoredPhoto(`scirank-photo:${scientist.scopusId || scientist.id}`);
    if (legacy) {
      setPhoto(legacy);
      writeStoredPhoto(storageKey, legacy);
    } else {
      setPhoto(null);
    }
  }, [storageKey, scientist.scopusId, scientist.id]);

  async function handlePhoto(file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) return;
    try {
      const dataUrl = await resizePhoto(file);
      setPhoto(dataUrl);
      writeStoredPhoto(storageKey, dataUrl);
    } catch {
      // keep current photo
    }
  }

  function clearPhoto() {
    setPhoto(null);
    writeStoredPhoto(storageKey, null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(url, {
      width: 220,
      margin: 0,
      color: { dark: "#111111", light: "#ffffff" },
    })
      .then((data) => {
        if (active) setQr(data);
      })
      .catch(() => {
        if (active) setQr("");
      });
    return () => {
      active = false;
    };
  }, [url]);

  return (
    <article
      id="scientist-print-card"
      className="relative mx-auto w-full max-w-[640px] overflow-hidden rounded-[24px] bg-[#2b7de9] px-6 pb-0 pt-12 text-black shadow-2xl print:max-w-[200mm] print:shadow-none"
    >
      <div className="absolute left-1/2 top-2 z-10 -translate-x-1/2">
        <label className="group relative grid size-[88px] cursor-pointer place-items-center overflow-hidden rounded-full border-[3px] border-white bg-[#eef2f6] shadow-md">
          {photo ? (
            <img src={photo} alt="" className="size-full object-cover" />
          ) : (
            <User size={42} strokeWidth={1.6} className="text-[#9aa3af]" />
          )}
          <span className="no-print absolute inset-0 grid place-items-center bg-slate-950/45 text-white opacity-0 transition group-hover:opacity-100">
            <Camera size={20} />
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              void handlePhoto(event.target.files?.[0]);
            }}
          />
        </label>
        {photo && (
          <button
            type="button"
            onClick={clearPhoto}
            className="no-print absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-white text-slate-500 shadow ring-1 ring-slate-200 hover:text-slate-900"
            aria-label="Remove photo"
          >
            <X size={11} />
          </button>
        )}
      </div>

      <div className="rounded-t-[20px] bg-white px-7 pb-5 pt-16">
        <h2 className="text-center text-[26px] font-semibold leading-tight tracking-tight text-[#2b7de9]">
          {scientist.name}
        </h2>

        <div className="mt-2 text-center leading-5 text-black">
          <p className="text-[14px]">
            {scientist.affiliation || "Institution not available"}
          </p>
          {flag && (
            <p className="mt-0.5 text-[22px] leading-none" aria-hidden>
              {flag}
            </p>
          )}
          <p className="mt-0.5 text-[14px]">{country || "—"}</p>
        </div>

        <div className="mt-4 rounded-full bg-[#2b7de9] px-4 py-1.5 text-center text-[16px] font-semibold text-white">
          Global Rank: {formatRank(scientist.rankGlobal)}
        </div>

        <div className="mt-5 flex justify-center">
          <div className="space-y-2.5 text-left">
            <Fact>
              <FactLabel label="Main Field" value={scientist.field || "—"} />
            </Fact>
            <Fact>
              <FactLabel label="Subfield" value={scientist.subfield || "—"} />
            </Fact>
            <Fact>
              <FactLabel
                label="Subfield Rank"
                value={formatSubfieldRank(scientist.rankSubfield, scientist.subfieldCount)}
              />
            </Fact>
            <Fact>
              <FactLabel label="h-index" value={formatIndex(scientist.hIndex)} />
              {", "}
              <FactLabel label="hm-index" value={formatIndex(scientist.hmIndex)} />
            </Fact>
          </div>
        </div>

        <div className="mt-5 text-center">
          <p className="text-[16px] font-semibold text-[#1d4ed8]">
            Top 2% Listed Year(s): 2026
          </p>
          <p className="mt-1 text-[13px] text-black">
            &ldquo;{listLabel}&rdquo; Data
          </p>
        </div>

        <div className="mt-5 grid grid-cols-[68px_minmax(0,1fr)_68px] items-center gap-x-2">
          <Top2Mark />
          <p className="text-center text-[12px] leading-[1.35] text-[#4b5563]">
            The data is verified and sourced from{" "}
            <span className="font-semibold text-[#e85a2a]">ELSEVIER</span> and
            <br />
            <span className="font-semibold text-[#8C1515]">Stanford University</span>
            &apos;s Top 2% Scientists list.
          </p>
          <div className="flex justify-end">
            {qr ? (
              <img src={qr} alt="" className="size-[60px]" />
            ) : (
              <div className="size-[60px] rounded bg-slate-100" />
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function fileStem(name: string) {
  return name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "scientist";
}

export function DetailPanel({
  scientist,
  onClose,
}: {
  scientist: ScientistRecord;
  onClose: () => void;
}) {
  const [showCertificate, setShowCertificate] = useState(false);
  const flag = countryFlag(scientist.country);
  const country = countryLabel(scientist.country);
  const listLabel = scientist.listType === "career" ? "Career-long" : "2026 single-year";

  function closeCertificate() {
    setShowCertificate(false);
  }

  function handleDownload() {
    const card = document.getElementById("scientist-print-card");
    if (!card) return;
    const widthMm = (card.offsetWidth / 96) * 25.4;
    const heightMm = (card.offsetHeight / 96) * 25.4;
    const pageStyle = document.createElement("style");
    pageStyle.textContent = `@media print { @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; } }`;
    document.head.appendChild(pageStyle);
    const previousTitle = document.title;
    document.title = `${fileStem(scientist.name)}-TOP2Scientists-2026`;
    const restore = () => {
      document.title = previousTitle;
      pageStyle.remove();
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
  }

  function handleGenerate() {
    setShowCertificate(true);
  }

  return (
    <div className="print-overlay fixed inset-0 z-50 print:static print:bg-transparent">
      <button
        aria-label="Close details"
        className="no-print absolute inset-0 cursor-default bg-slate-950/25"
        onClick={onClose}
      />

      {showCertificate ? (
        <div className="no-print fixed inset-0 z-[70] bg-slate-950/70">
          <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-3">
            <p className="text-[13px] font-semibold tracking-wide text-white uppercase">
              Certificate
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex h-9 items-center rounded-lg bg-[#3558d4] px-3 text-sm font-semibold text-white shadow-sm hover:bg-[#2c4cbe]"
              >
                Download
              </button>
              <button
                type="button"
                onClick={closeCertificate}
                className="rounded-full border border-slate-200 bg-white p-1.5 text-slate-500 transition hover:bg-slate-50 hover:text-slate-950"
                aria-label="Back to profile"
              >
                <X size={15} />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <aside className={`no-print absolute right-3 top-3 flex max-h-[calc(100vh-1.5rem)] w-[min(640px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl border border-[#e3e8f1] bg-white shadow-[0_10px_35px_rgba(25,38,75,0.12)] ${showCertificate ? "invisible" : ""}`}>
          <div className="flex items-center justify-between border-b border-[#e3e8f1] px-4 py-3">
            <p className="text-[13px] font-semibold tracking-wide text-slate-500 uppercase">
              Scientist profile
            </p>
            <button
              onClick={onClose}
              className="rounded-full border border-slate-200 bg-white p-1.5 text-slate-500 transition hover:bg-slate-50 hover:text-slate-950"
              aria-label="Close"
            >
              <X size={15} />
            </button>
          </div>

          <div className="overflow-y-auto px-4 py-4">
            <p className="text-[12px] font-medium text-[#3558d4]">{listLabel}</p>
            <h2 className="mt-1 text-[22px] font-semibold leading-tight tracking-tight text-[#152033]">
              {scientist.name}
            </h2>
            <p className="mt-1.5 text-[14px] leading-5 text-slate-600">
              {scientist.affiliation || "Institution not available"}
            </p>
            <p className="mt-1 text-[14px] text-slate-600">
              {flag ? `${flag} ` : ""}
              {country || "—"}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 rounded-xl bg-[#f6f8fc] px-3.5 py-3.5">
              <Stat label="Overall Rank" value={formatCount(scientist.rankGlobal)} />
              <Stat label="Rank in SubField 1" value={formatCount(scientist.rankSubfield)} />
              <Stat label="Publications" value={formatCount(scientist.papers)} />
              <Stat label="Citations" value={formatCount(scientist.citations)} />
            </div>

            <div className="mt-3 grid grid-cols-3 gap-3 rounded-xl bg-[#f6f8fc] px-3.5 py-3.5">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-slate-500">Main Field</p>
                <p className="mt-1 text-[13px] font-medium leading-5 text-[#152033]">
                  {scientist.field || "—"}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-slate-500">SubField 1</p>
                <p className="mt-1 text-[13px] font-medium leading-5 text-[#152033]">
                  {scientist.subfield || "—"}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-slate-500">SubField 2</p>
                <p className="mt-1 text-[13px] font-medium leading-5 text-[#152033]">
                  {scientist.subfield2 || "—"}
                </p>
              </div>
            </div>

            <p className="mt-3 rounded-xl bg-[#f6f8fc] px-3.5 py-3 text-[13px] leading-5 text-[#152033]">
              Rank in SubField 1:{" "}
              <span className="font-semibold tabular-nums">{formatCount(scientist.rankSubfield)}</span>
              {scientist.subfieldCount ? (
                <>
                  {" "}
                  out of{" "}
                  <span className="font-semibold tabular-nums">
                    {formatCount(scientist.subfieldCount)}
                  </span>{" "}
                  researchers
                  {scientist.rankSubfield ? (
                    <span className="font-semibold tabular-nums"> ({formatShare(scientist.rankSubfield, scientist.subfieldCount)})</span>
                  ) : null}
                </>
              ) : null}
            </p>

            <button
              type="button"
              onClick={handleGenerate}
              className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#3558d4] text-[16px] font-semibold text-white shadow-[0_8px_20px_rgba(53,88,212,0.28)] transition hover:bg-[#2c4cbe]"
            >
              <GraduationCap size={18} />
              Generate certificate
            </button>

            <div className="mt-5 overflow-hidden rounded-xl border border-slate-200">
              <p className="bg-[#f6f8fc] px-3 py-2 text-center text-[13px] font-semibold text-[#152033]">
                {scientist.listType === "career" ? "Career-long Data" : "Data For The Year: 2026"}
              </p>
              <table className="w-full border-collapse px-1">
                <thead>
                  <tr className="text-[11px] text-slate-500">
                    <th className="px-3 pt-2 pb-1 text-left font-medium">Metrics</th>
                    <th className="px-2 pt-2 pb-1 text-right font-medium">Self-Citations Excluded</th>
                    <th className="px-3 pt-2 pb-1 text-right font-medium">All</th>
                  </tr>
                </thead>
                <tbody className="px-3">
                  <MetricRow
                    label="Rank Based on Composite Score"
                    excluded={formatCount(scientist.rankGlobal)}
                    all={formatCount(scientist.rankGlobalAll)}
                  />
                  <MetricRow
                    label="Total Cites"
                    excluded={formatCount(scientist.citations)}
                    all={formatCount(scientist.citationsAll)}
                  />
                  <MetricRow
                    label="H-index"
                    excluded={formatIndex(scientist.hIndex)}
                    all={formatIndex(scientist.hIndexAll)}
                  />
                  <MetricRow
                    label="Hm-index"
                    excluded={formatIndex(scientist.hmIndex)}
                    all={formatIndex(scientist.hmIndexAll)}
                  />
                  <MetricRow
                    label="Number of Single Authored Papers"
                    excluded={formatCount(scientist.singlePapers)}
                    all={formatCount(scientist.singlePapersAll)}
                  />
                  <MetricRow
                    label="Total Cites to Single Authored Papers"
                    excluded={formatCount(scientist.singleCites)}
                    all={formatCount(scientist.singleCitesAll)}
                  />
                  <MetricRow
                    label="Number of Single+First Authored Papers"
                    excluded={formatCount(scientist.firstPapers)}
                    all={formatCount(scientist.firstPapersAll)}
                  />
                  <MetricRow
                    label="Total Cites to Single+First Authored Papers"
                    excluded={formatCount(scientist.firstCites)}
                    all={formatCount(scientist.firstCitesAll)}
                  />
                  <MetricRow
                    label="Number of Single+First+Last Authored Papers"
                    excluded={formatCount(scientist.lastPapers)}
                    all={formatCount(scientist.lastPapersAll)}
                  />
                  <MetricRow
                    label="Total Cites to Single+First+Last Authored Papers"
                    excluded={formatCount(scientist.lastCites)}
                    all={formatCount(scientist.lastCitesAll)}
                  />
                  <MetricRow
                    label="Composite Score"
                    excluded={formatIndex(scientist.cScore)}
                    all={formatIndex(scientist.cScoreAll)}
                  />
                  <MetricRow
                    label="Number of Distinct Citing Papers"
                    excluded={formatCount(scientist.citingPapers)}
                    all={formatCount(scientist.citingPapersAll)}
                  />
                  <MetricRow
                    label="Ratio of Total Citations to Distinct Citing Papers"
                    excluded={formatRatio(scientist.citeRatio)}
                    all={formatRatio(scientist.citeRatioAll)}
                  />
                </tbody>
              </table>
              <div className="flex items-center gap-3 border-t border-slate-100 px-3 py-2.5">
                <p className="shrink-0 text-[12px] font-medium text-slate-600">Self-citation Percentage</p>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-cyan-400"
                    style={{ width: `${Math.min(100, scientist.selfCitationPct ?? 0)}%` }}
                  />
                </div>
                <p className="shrink-0 text-[13px] tabular-nums text-[#152033]">
                  {formatPercent(scientist.selfCitationPct)}
                </p>
              </div>
            </div>
            <p className="mt-3 text-[12px] text-slate-500">
              Publication years:{" "}
              <span className="font-medium text-[#152033]">
                {scientist.firstPublicationYear || scientist.lastPublicationYear
                  ? `${scientist.firstPublicationYear ?? "—"} – ${scientist.lastPublicationYear ?? "—"}`
                  : "—"}
              </span>
            </p>
          </div>
        </aside>
      <div className={showCertificate ? "certificate-visible" : "certificate-offscreen"}>
        <ScientistCertificate scientist={scientist} />
      </div>
    </div>
  );
}
