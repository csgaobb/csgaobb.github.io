import { Camera, GraduationCap, Printer, User, X } from "../lib/icons";
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
      if (!context) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("canvas"));
        return;
      }
      context.fillStyle = "#eef2f6";
      context.fillRect(0, 0, size, size);
      const inset = size * 0.08;
      const box = size - inset * 2;
      const scale = Math.min(box / image.width, box / image.height);
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;
      context.drawImage(
        image,
        (size - drawWidth) / 2,
        (size - drawHeight) / 2,
        drawWidth,
        drawHeight,
      );
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL("image/jpeg", 0.86));
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
            <img src={photo} alt="" className="size-full object-contain" />
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
                label="Global Rank in the Subfield"
                value={formatRank(scientist.rankSubfield)}
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

export function DetailPanel({
  scientist,
  onClose,
}: {
  scientist: ScientistRecord;
  onClose: () => void;
}) {
  return (
    <div className="print-overlay fixed inset-0 z-50 print:static print:bg-transparent">
      <button
        aria-label="Close details"
        className="no-print absolute inset-0 cursor-default bg-slate-950/25"
        onClick={onClose}
      />
      <aside className="absolute right-3 top-3 w-max max-w-[calc(100%-1.5rem)] overflow-hidden rounded-2xl bg-[#edf3fb] shadow-2xl print:relative print:right-auto print:top-auto print:w-full print:max-w-none print:rounded-none print:bg-white print:shadow-none">
        <div className="no-print flex items-center justify-between px-3 py-2">
          <p className="text-sm font-medium text-slate-700">Printable card</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#2b7de9] px-2.5 text-sm font-medium text-white hover:bg-[#1d6fd6]"
            >
              <Printer size={14} />
              Print
            </button>
            <button
              onClick={onClose}
              className="rounded-full border border-slate-200 bg-white p-1.5 text-slate-500 transition hover:bg-slate-50 hover:text-slate-950"
              aria-label="Close"
            >
              <X size={15} />
            </button>
          </div>
        </div>
        <div className="max-h-[calc(100vh-1.5rem)] overflow-y-auto px-3 pb-3 print:max-h-none print:overflow-visible print:p-0">
          <ScientistCertificate scientist={scientist} />
        </div>
      </aside>
    </div>
  );
}
