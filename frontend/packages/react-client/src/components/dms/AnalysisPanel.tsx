import React, { useEffect, useMemo, useState } from "react";
import { useDms } from "../../store/dms-store";
import { nlp } from "../../services/nlp-service";
import { dms, isImageFile } from "../../services/dms-service";
import type { ImageAnalysis } from "../../services/dms-service";
import { KIND_LABEL, KIND_ICON } from "../../services/dms-service";
import type { SentimentData, Keyword, Entity } from "../../services/nlp-service";
import type { ZoneHistoryItem } from "../../services/dms-service";
import Icon from "../Icon";
import type { IconName } from "../Icon";

function fmtBytes(b: number): string {
  if (b < 1024)           return `${b} B`;
  if (b < 1024 * 1024)    return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3)      return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

function fmtDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "2-digit",
  });
}

function SentimentBadge({ data }: { data: SentimentData }) {
  const cls =
    data.label === "POSITIVE"
      ? "text-emerald-500 dark:text-emerald-400"
      : data.label === "NEGATIVE"
      ? "text-rose-500 dark:text-rose-400"
      : "text-[var(--theme-text-muted)]";
  return (
    <span className={`font-semibold ${cls}`}>
      {data.label} ({Math.round(data.confidence * 100)}%)
    </span>
  );
}

const AnalysisPanel: React.FC = () => {
  const { state, dispatch } = useDms();
  const [keywords, setKeywords]   = useState<Keyword[]>([]);
  const [entities, setEntities]   = useState<Entity[]>([]);
  const [sentiment, setSentiment] = useState<SentimentData | null>(null);
  const [lang, setLang]           = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);
  const [zones, setZones]         = useState<ZoneHistoryItem[]>([]);
  const [isFiling, setIsFiling]   = useState(false);
  const [ocrExpanded, setOcrExpanded] = useState(true);
  const [exif, setExif]           = useState<Record<string, unknown> | null>(null);
  const [exifExpanded, setExifExpanded] = useState(false);
  const [imageAnalysis, setImageAnalysis] = useState<ImageAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const isImage = state.viewerPath ? isImageFile(state.viewerPath) : false;

  // Text to run live NLP on:
  //   1. Fresh OCR / viewer text (highest priority)
  //   2. Stored DB snippet (enables analysis on re-navigation without re-OCR)
  const analysisText = useMemo(() => {
    if (state.viewerContent && state.viewerContent.trim().length >= 10)
      return state.viewerContent;
    if (state.metadata?.snippet && state.metadata.snippet.trim().length >= 10)
      return state.metadata.snippet;
    return null;
  }, [state.viewerContent, state.metadata?.snippet]);

  // ── Universal colour extraction ────────────────────────────────────────────
  // Detects hex / rgb / rgba / hsl colour literals in any text content
  // (CSS, HTML, JSON, theme files, etc.) and surfaces them as swatches in the
  // panel.  Not locked to CSS — any file kind that has colour syntax triggers it.
  const extractedColors = useMemo(() => {
    const text = state.viewerContent;
    if (!text || text.length < 4) return [] as string[];
    const found = new Set<string>();
    // hex: #abc or #aabbcc or #aabbccdd
    const hexRe = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
    for (const m of text.matchAll(hexRe)) found.add(m[0].toLowerCase());
    // rgb / rgba
    const rgbRe = /rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*[\d.]+)?\s*\)/g;
    for (const m of text.matchAll(rgbRe)) found.add(m[0].toLowerCase());
    // hsl / hsla
    const hslRe = /hsla?\(\s*\d{1,3}\s*,\s*[\d.]+%\s*,\s*[\d.]+%(?:\s*,\s*[\d.]+)?\s*\)/g;
    for (const m of text.matchAll(hslRe)) found.add(m[0].toLowerCase());
    return Array.from(found).slice(0, 36);
  }, [state.viewerContent]);

  // Reset live NLP state whenever selected file changes (not just content)
  useEffect(() => {
    setKeywords([]);
    setEntities([]);
    setSentiment(null);
    setLang(null);
    setExif(null);
  }, [state.selectedPath]);

  // Fetch EXIF for images
  useEffect(() => {
    if (!isImage || !state.viewerPath) return;
    dms.getExif(state.viewerPath).then(res => {
      if (res.ok && res.data && Object.keys(res.data).length > 0) {
        setExif(res.data);
      }
    });
  }, [isImage, state.viewerPath]);

  // Analyse image palette + histogram
  useEffect(() => {
    setImageAnalysis(null);
    if (!isImage || !state.viewerPath) return;
    let cancelled = false;
    setIsAnalyzing(true);
    dms.imageAnalyze(state.viewerPath).then(res => {
      if (!cancelled && res.ok && res.data) setImageAnalysis(res.data);
    }).finally(() => { if (!cancelled) setIsAnalyzing(false); });
    return () => { cancelled = true; };
  }, [isImage, state.viewerPath]);

  // Run live NLP whenever analysisText changes
  useEffect(() => {
    if (!analysisText) return;

    setLoading(true);
    const text = analysisText.slice(0, 4000);

    Promise.all([
      nlp.keywords(text, 10),
      nlp.entities(text),
      nlp.sentiment(text),
      nlp.detectLanguage(text),
    ])
      .then(([kw, ent, sent, langRes]) => {
        if (kw.ok && kw.data)     setKeywords(kw.data.slice(0, 12));
        if (ent.ok && ent.data)   setEntities(ent.data.slice(0, 15));
        if (sent.ok && sent.data) setSentiment(sent.data);
        if (langRes.ok && langRes.data) setLang(langRes.data.language);
      })
      .finally(() => setLoading(false));
  }, [analysisText]);

  // Zones for "File to Zone" button
  useEffect(() => {
    if (state.isGlobalMode && state.selectedPath) {
      dms.getZones().then((res) => {
        if (res.ok && res.data) setZones(res.data);
      });
    }
  }, [state.isGlobalMode, state.selectedPath]);

  const handleFileToZone = async (zoneName: string) => {
    if (!state.selectedPath) return;
    setIsFiling(true);
    try {
      const res = await dms.fileToZone(state.selectedPath, zoneName);
      if (res.ok) {
        dispatch({ type: "SELECT_FILE", path: null });
      } else {
        alert("Failed to file: " + res.error);
      }
    } finally {
      setIsFiling(false);
    }
  };

  // Derive what to display — live NLP takes priority, stored metadata as fallback
  const displayKeywords  = keywords.length > 0
    ? keywords
    : (state.metadata?.keywords ?? []) as unknown as Keyword[];
  const displayEntities  = entities.length > 0
    ? entities
    : (state.metadata?.entities ?? []) as unknown as Entity[];
  const displayLang      = lang ?? state.metadata?.lang ?? null;
  const displaySentiment: SentimentData | null = sentiment
    ?? (state.metadata
          ? { label: state.metadata.sentimentLabel.toUpperCase(), confidence: Math.abs(state.metadata.sentiment), score: state.metadata.sentiment }
          : null);

  const hasAnyData = displayKeywords.length > 0 || displayEntities.length > 0
    || displaySentiment !== null || !!state.viewerContent || !!state.metadata;

  if (!state.selectedPath && !state.fileStats) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 p-6 text-center">
        <span className="text-2xl opacity-20">🔬</span>
        <p className="text-xs text-[var(--theme-text-muted)]">
          Select a file to see its info and analysis
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5 bg-[var(--theme-surface)]">

      {/* ── File Info Card — always shown when fileStats available ── */}
      {state.fileStats && (() => {
        const fs = state.fileStats;
        const kindLabel = KIND_LABEL[fs.kind] ?? "File";
        const kindIcon  = KIND_ICON[fs.kind]  ?? "file";
        return (
          <section className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] overflow-hidden">
            {/* Title row */}
            <div className="flex items-center gap-2.5 px-3 py-2.5">
              <span className="shrink-0 text-[var(--theme-text-muted)]">
                <Icon name={kindIcon as IconName} size="sm" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-[var(--theme-text)] truncate">
                  {fs.name}
                </p>
                <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)]">
                  {kindLabel}{fs.ext ? ` · ${fs.ext.toUpperCase()}` : ""}
                </p>
              </div>
              <div className="flex flex-col items-end gap-0.5 shrink-0">
                {fs.indexed
                  ? <span className="text-[8px] font-bold uppercase tracking-wider text-emerald-500 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"/>Indexed</span>
                  : <span className="text-[8px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[var(--theme-border)] inline-block"/>Not indexed</span>
                }
              </div>
            </div>
            {/* Stats grid */}
            <div className="grid grid-cols-2 border-t border-[var(--theme-border)]">
              <div className="px-3 py-1.5 bg-[var(--theme-surface)]">
                <p className="text-[8px] uppercase font-bold text-[var(--theme-text-muted)]">Size</p>
                <p className="text-[11px] font-mono text-[var(--theme-text)]">{fmtBytes(fs.size)}</p>
              </div>
              <div className="px-3 py-1.5 bg-[var(--theme-surface)] border-l border-[var(--theme-border)]">
                <p className="text-[8px] uppercase font-bold text-[var(--theme-text-muted)]">Modified</p>
                <p className="text-[11px] font-mono text-[var(--theme-text)]">{fmtDate(fs.mtime)}</p>
              </div>
              <div className="col-span-2 px-3 py-1.5 bg-[var(--theme-surface)] border-t border-[var(--theme-border)]">
                <p className="text-[8px] uppercase font-bold text-[var(--theme-text-muted)]">MIME</p>
                <p className="text-[10px] font-mono text-[var(--theme-text)] truncate">{fs.mime}</p>
              </div>
            </div>
          </section>
        );
      })()}

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black uppercase tracking-widest text-[var(--theme-text-muted)]">
          Analysis{" "}
          {loading && (
            <span className="text-[var(--theme-primary)] animate-pulse ml-1">●</span>
          )}
          {keywords.length > 0 && !loading && (
            <span className="text-[10px] normal-case font-normal ml-1 opacity-50">
              (live)
            </span>
          )}
          {keywords.length === 0 && (state.metadata?.keywords?.length ?? 0) > 0 && !loading && (
            <span className="text-[10px] normal-case font-normal ml-1 opacity-50">
              (stored)
            </span>
          )}
        </h3>

        {state.isGlobalMode && state.selectedPath && zones.length > 0 && (
          <div className="relative group">
            <button
              disabled={isFiling}
              className="px-2 py-1 text-[10px] bg-[var(--theme-primary)] hover:opacity-90 text-white dark:text-[var(--theme-bg)] rounded shadow-lg transition-colors disabled:opacity-50"
            >
              {isFiling ? "Filing..." : "File to Zone"}
            </button>
            <div className="absolute right-0 top-full mt-1 hidden group-hover:block z-50 min-w-[120px] bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded shadow-xl py-1">
              {zones.map((z) => (
                <button
                  key={z.name}
                  onClick={() => handleFileToZone(z.name)}
                  className="w-full text-left px-3 py-1.5 text-[10px] text-[var(--theme-text)] hover:bg-[var(--theme-bg)]"
                >
                  {z.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Language + Sentiment ── */}
      {(displayLang || displaySentiment) && (
        <section className="space-y-1.5">
          {displayLang && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[var(--theme-text-muted)] w-20 shrink-0">Language</span>
              <span className="font-mono text-[var(--theme-text)] uppercase">{displayLang}</span>
            </div>
          )}
          {displaySentiment && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[var(--theme-text-muted)] w-20 shrink-0">Sentiment</span>
              <SentimentBadge data={displaySentiment} />
            </div>
          )}
        </section>
      )}

      {/* ── Keywords ── */}
      {displayKeywords.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-[var(--theme-text-muted)] mb-2">Keywords</h4>
          <div className="flex flex-wrap gap-1.5">
            {displayKeywords.map((kw) => (
              <span
                key={kw.term}
                className="px-2 py-0.5 rounded-full bg-[var(--theme-bg)] text-[var(--theme-text)] text-xs border border-[var(--theme-border)]"
                title={`Score: ${ ("tfidf_score" in kw ? (kw as any).tfidf_score : (kw as any).tfidfScore ?? 0).toFixed(3)}`}
              >
                {kw.term}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ── Entities ── */}
      {displayEntities.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-[var(--theme-text-muted)] mb-2">Entities</h4>
          <div className="space-y-1">
            {displayEntities.map((e, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="px-1.5 py-0.5 rounded bg-[var(--theme-bg)] text-[var(--theme-primary)] font-mono text-[10px] shrink-0 border border-[var(--theme-border)]">
                  {e.type}
                </span>
                <span className="text-[var(--theme-text)] truncate">{e.text}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── OCR / Extracted Text — only for images ── */}
      {/* For text files the content is already visible in the document viewer */}
      {isImage && (() => {
        const textToShow = state.viewerContent?.trim()
          || state.metadata?.snippet?.trim()
          || null;
        if (!textToShow) return null;
        const isFresh = !!state.viewerContent?.trim();
        return (
          <section className="border border-[var(--theme-border)] rounded-xl overflow-hidden">
            <button
              onClick={() => setOcrExpanded(e => !e)}
              className="w-full flex items-center justify-between px-3 py-2 bg-[var(--theme-bg)] text-[10px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors"
            >
              <span>Extracted Text{!isFresh && <span className="ml-1 normal-case font-normal opacity-60">(stored)</span>}</span>
              <span className="opacity-50">{ocrExpanded ? "▲" : "▼"}</span>
            </button>
            {ocrExpanded && (
              <p className="px-3 py-2 text-[11px] leading-relaxed text-[var(--theme-text)] whitespace-pre-wrap break-words max-h-48 overflow-y-auto italic bg-[var(--theme-surface)]">
                {textToShow}
              </p>
            )}
          </section>
        );
      })()}

      {/* ── EXIF Metadata (images only) ── */}
      {isImage && exif && Object.keys(exif).length > 0 && (
        <section className="border border-[var(--theme-border)] rounded-xl overflow-hidden">
          <button
            onClick={() => setExifExpanded(e => !e)}
            className="w-full flex items-center justify-between px-3 py-2 bg-[var(--theme-bg)] text-[10px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors"
          >
            <span>Image Info</span>
            <span className="opacity-50">{exifExpanded ? "▲" : "▼"}</span>
          </button>
          {exifExpanded && (
            <div className="px-3 py-2 bg-[var(--theme-surface)] space-y-1">
              {(Object.entries(exif) as [string, unknown][]).map(([k, v]) => {
                const label: Record<string, string> = {
                  width: "Width", height: "Height", dpiX: "DPI X", dpiY: "DPI Y",
                  colorModel: "Color", colorProfile: "Profile", orientation: "Orientation",
                  cameraMake: "Camera Make", cameraModel: "Camera Model",
                  lensModel: "Lens", lensMake: "Lens Make",
                  dateTime: "Date Taken", software: "Software",
                  aperture: "Aperture (f/)", exposureSec: "Exposure",
                  focalLength: "Focal Length", iso: "ISO",
                  flash: "Flash", colorSpace: "Color Space",
                  exposureBias: "EV Bias", whiteBalance: "White Bal.",
                  pixelDimensions: "Pixel Size",
                  gpsLat: "GPS Lat", gpsLon: "GPS Lon", gpsAlt: "GPS Alt",
                };
                const display = String(v);
                let fmtV = display;
                if (k === "aperture") fmtV = `f/${parseFloat(display).toFixed(1)}`;
                else if (k === "exposureSec") {
                  const s = parseFloat(display);
                  fmtV = s < 1 ? `1/${Math.round(1/s)}s` : `${s.toFixed(1)}s`;
                } else if (k === "focalLength") fmtV = `${parseFloat(display).toFixed(0)} mm`;
                else if (k === "gpsLat" || k === "gpsLon") fmtV = parseFloat(display).toFixed(6);
                else if (k === "gpsAlt") fmtV = `${parseFloat(display).toFixed(0)} m`;
                else if (k === "flash") fmtV = Number(display) & 1 ? "Fired" : "No flash";
                else if (k === "whiteBalance") fmtV = Number(display) === 0 ? "Auto" : "Manual";
                return (
                  <div key={k} className="flex items-center gap-2 text-[11px]">
                    <span className="text-[var(--theme-text-muted)] w-24 shrink-0 text-[10px]">{label[k] ?? k}</span>
                    <span className="font-mono text-[var(--theme-text)] truncate">{fmtV}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ── Stored DB Metadata ── */}
      {state.metadata && (
        <section className="border-t border-[var(--theme-border)] pt-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <h4 className="text-xs font-black uppercase tracking-widest text-[var(--theme-text-muted)]">
              Database Entry
            </h4>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="bg-[var(--theme-bg)] p-2 rounded border border-[var(--theme-border)]">
              <p className="text-[9px] uppercase font-bold text-[var(--theme-text-muted)] mb-1">Indexed</p>
              <p className="font-mono">
                {new Date(state.metadata.indexedAt * 1000).toLocaleDateString()}
              </p>
            </div>
            <div className="bg-[var(--theme-bg)] p-2 rounded border border-[var(--theme-border)]">
              <p className="text-[9px] uppercase font-bold text-[var(--theme-text-muted)] mb-1">Size</p>
              <p className="font-mono">
                {state.metadata.sizeBytes < 1024
                  ? `${state.metadata.sizeBytes} B`
                  : state.metadata.sizeBytes < 1048576
                  ? `${(state.metadata.sizeBytes / 1024).toFixed(1)} KB`
                  : `${(state.metadata.sizeBytes / 1048576).toFixed(1)} MB`}
              </p>
            </div>
          </div>

          {/* Show snippet in DB section only when NOT already shown in Extracted Text above */}
          {state.metadata.snippet && !state.viewerContent && !isImage && (
            <div className="bg-[var(--theme-bg)] p-3 rounded border border-[var(--theme-border)]">
              <p className="text-[9px] uppercase font-bold text-[var(--theme-text-muted)] mb-1">Snippet</p>
              <p className="text-[11px] leading-relaxed opacity-90 line-clamp-4 italic">
                &ldquo;{state.metadata.snippet}&rdquo;
              </p>
            </div>
          )}

          {state.metadata.dimensions > 0 && (
            <p className="text-[9px] text-[var(--theme-text-muted)] text-right">
              Vector: {state.metadata.dimensions} dimensions
            </p>
          )}
        </section>
      )}

      {/* ── Colour swatches — auto-detected from any text content ── */}
      {extractedColors.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-[var(--theme-text-muted)] mb-2">
            Colors <span className="opacity-50 font-normal">({extractedColors.length})</span>
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {extractedColors.map((color) => (
              <div
                key={color}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] cursor-default"
                title={color}
              >
                <span
                  className="w-3 h-3 rounded-sm shrink-0 border border-black/10"
                  style={{ background: color }}
                />
                <span className="text-[9px] font-mono text-[var(--theme-text-muted)]">{color}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Loading skeleton ── */}
      {loading && displayKeywords.length === 0 && (
        <div className="space-y-2">
          {[60, 80, 45, 70].map((w, i) => (
            <div
              key={i}
              className="h-3 rounded bg-[var(--theme-bg)] animate-pulse"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      )}

      {/* ── Image palette & histogram ──────────────────────────────────────── */}
      {isImage && (
        <div className="mt-3 space-y-2">
          {isAnalyzing && (
            <div className="flex items-center gap-2 text-[var(--theme-text-muted)] text-[10px]">
              <span className="w-3 h-3 border border-current/40 border-t-current rounded-full animate-spin" />
              Analysing palette…
            </div>
          )}
          {imageAnalysis && (
            <>
              {/* Colour palette swatches */}
              <div>
                <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)] mb-1.5">
                  Colour Palette ({imageAnalysis.palette.length})
                </p>
                <div className="flex flex-wrap gap-1">
                  {imageAnalysis.palette.map((c, i) => (
                    <div key={i} title={`${c.hex} · ${c.pct}%`}
                      className="flex flex-col items-center gap-0.5 cursor-default">
                      <div
                        className="w-6 h-6 rounded border border-[var(--theme-border)]/60 shadow-sm"
                        style={{ background: c.hex }}
                      />
                      <span className="text-[7px] text-[var(--theme-text-muted)] font-mono leading-none">
                        {c.pct > 0.5 ? `${c.pct}%` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              {/* RGB histogram — thin stacked bars */}
              <div>
                <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)] mb-1">
                  RGB Histogram
                </p>
                {(['r','g','b'] as const).map(ch => {
                  const data = imageAnalysis.histogram[ch];
                  const max = Math.max(...data, 1);
                  const color = ch === 'r' ? '#ef4444' : ch === 'g' ? '#22c55e' : '#3b82f6';
                  return (
                    <div key={ch} className="flex items-end gap-px h-8 mb-0.5">
                      {data.filter((_, i) => i % 4 === 0).map((v, i) => (
                        <div
                          key={i}
                          className="flex-1 min-w-0 rounded-sm opacity-80"
                          style={{ height: `${Math.round((v / max) * 100)}%`, background: color }}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default AnalysisPanel;
