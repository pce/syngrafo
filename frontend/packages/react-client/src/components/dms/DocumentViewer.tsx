import React, { useEffect, useState, useMemo } from "react";
import { useDms } from "../../store/dms-store";
import { useSettings } from "../../store/settings-store";
import { dms, isImageFile, isDocFile, is3DFile } from "../../services/dms-service";
import Icon from "../Icon";
import type { IconName } from "../Icon";
import { isAudioFile, isVideoFile, isSvgFile, isArchiveFile, isHtmlFile } from "../../services/dms-service";
import { useAudioPlaybackWithVisualization } from "../../hooks/useAudioPlaybackWithVisualization";
import SlidingAudioVisualizer from "../audio/SlidingAudioVisualizer";
import SpectrumAnalyzer from "../audio/SpectrumAnalyzer";
import ThreeDViewer from "./ThreeDViewer";
import VideoPlayer   from "./VideoPlayer";

const DocumentViewer: React.FC = () => {
  const { state, dispatch } = useDms();
  const { settings } = useSettings();
  const [isOcrLoading,       setIsOcrLoading]       = useState(false);
  const [isRectifyLoading,   setIsRectifyLoading]   = useState(false);
  const [isPdfExportLoading, setIsPdfExportLoading] = useState(false);
  const [isToSvgLoading,     setIsToSvgLoading]     = useState(false);
  const [isToSvgPolyLoading, setIsToSvgPolyLoading] = useState(false);
  const [isToSvgTriLoading,  setIsToSvgTriLoading]  = useState(false);
  const [svgPalette, setSvgPalette] = useState<string>("db16");
  const [svgFabExpanded,     setSvgFabExpanded]     = useState(false);
  const [ocrQuality, setOcrQuality] = useState<"ok" | "low" | "garbage" | null>(null);
  const [isIndexLoading,  setIsIndexLoading]  = useState(false);
  const [isImportLoading, setIsImportLoading] = useState(false);

  // ── Media error state ─────────────────────────────────────────────────────
  const [mediaError, setMediaError] = useState(false);
  const [fetchKey,   setFetchKey]   = useState(0);

  // ── File-type flags ───────────────────────────────────────────────────────
  // Declared first so they are available to every hook/expression below.
  const isImage   = state.viewerPath ? isImageFile(state.viewerPath)   : false;
  const isPdf     = state.viewerPath ? isDocFile(state.viewerPath)     : false;
  const isAudio   = state.viewerPath ? isAudioFile(state.viewerPath)   : false;
  const isArchive = state.viewerPath ? isArchiveFile(state.viewerPath) : false;
  const isHtml    = state.viewerPath ? isHtmlFile(state.viewerPath)    : false;
  const isVideo   = state.viewerPath ? isVideoFile(state.viewerPath)   : false;
  const isSvg     = state.viewerPath ? isSvgFile(state.viewerPath)     : false;
  const is3D      = state.viewerPath ? is3DFile(state.viewerPath)      : false;

  // ── Large-file guard ─────────────────────────────────────────────────────
  // Files above this threshold are not buffered through Web Audio decodeAudioData
  // (which loads the full file into RAM and can freeze the process).
  // Instead they are played via the native <audio> HTML element, which streams
  // through the local:// scheme handler (now with HTTP 206 Range support).
  const AUDIO_WEBAUDIO_MAX_BYTES = 60 * 1024 * 1024; // 60 MB
  const [fileSizeBytes, setFileSizeBytes] = useState<number | null>(null);
  const isLargeAudio = isAudio && fileSizeBytes !== null && fileSizeBytes > AUDIO_WEBAUDIO_MAX_BYTES;

  useEffect(() => {
    setFileSizeBytes(null);
    if (!state.viewerPath || (!isAudio && !isVideo)) return;
    dms.fileStats(state.viewerPath).then(res => {
      if (res.ok && res.data) setFileSizeBytes(res.data.size);
    });
  }, [state.viewerPath, isAudio, isVideo]);


  const isInZoneWorkspace = !!(state.zone && state.currentPath &&
    state.currentPath.startsWith(state.zone.out_path));
  const isInZoneSource = !!(state.zone && !isInZoneWorkspace);

  // ── SVG inline state ──────────────────────────────────────────────────────
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null);
  const [svgError,  setSvgError]  = useState(false);
  const [svgSizeError, setSvgSizeError] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const {
    play,
    stop,
    isLoading: isAudioLoading,
    analyserNode,
    visualizationData,
    isPlaying,
  } = useAudioPlaybackWithVisualization();

  // Reset error flag whenever the selected path or fetchKey changes.
  useEffect(() => {
    setMediaError(false);
    setOcrQuality(null);
    setAudioError(null);
  }, [state.viewerPath, fetchKey]);

  // ── local:// URL builder ──────────────────────────────────────────────────
  // Encode each path segment independently so that file names containing
  // spaces, brackets, or other URL-special characters survive the browser's
  // URL parser and reach the saucer scheme handler correctly.
  // The handler in main.cc percent-decodes the path before opening the file.
  const toLocalUrl = (path: string): string =>
    "local://local" + path.split("/").map(encodeURIComponent).join("/");

  // Stop audio when the viewer path changes
  useEffect(() => {
    stop();
  }, [state.viewerPath]);

  // ── SVG inline loader ─────────────────────────────────────────────────
  // SVG files are XML text — we fetch them via the local:// scheme and inject
  // the markup inline so the vector graphic renders at full quality without
  // hitting <img> / custom-scheme security restrictions on WebKitGTK / Edge.
  useEffect(() => {
    setSvgMarkup(null);
    setSvgError(false);
    setSvgSizeError(false);
    if (!isSvg || !state.viewerPath) return;

    const url = toLocalUrl(state.viewerPath);
    let cancelled = false;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((raw) => {
        if (cancelled) return;
        // Guard: skip inline injection when the file exceeds the configured
        // preview limit (default 2 MB, adjustable in Theme & Settings panel).
        if (raw.length > settings.svgPreviewMaxBytes) {
          setSvgSizeError(true);
          return;
        }
        // Minimal sanitization: strip <script> elements and javascript: hrefs
        // (SVGs can embed scripts; we don't want them executing in the preview).
        const safe = raw
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/href\s*=\s*["']\s*javascript:[^"']*/gi, 'href="#"')
          .replace(/\bon\w+\s*=/gi, "data-removed=");
        setSvgMarkup(safe);
      })
      .catch(() => { if (!cancelled) setSvgError(true); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSvg, state.viewerPath]);

  // ── Metadata loader ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!state.viewerPath) return;
    dms.getMetadata(state.viewerPath).then((res) => {
      dispatch({ type: "SET_METADATA", metadata: (res.ok && res.data) ? res.data : null });
    });
  }, [state.viewerPath, dispatch]);

  // Resolved src for the current viewer path.
  const mediaSrc = state.viewerPath ? toLocalUrl(state.viewerPath) : null;

  // Smart index: images → OCR first; everything else → indexDocument
  // (backend now handles HTML stripping and SVG text extraction automatically)
  const smartIndex = async () => {
    if (!state.selectedPath) return;
    // Images (non-SVG) must go through OCR to produce indexable text
    if (isImage && !isSvg) {
      return doOcr();
    }
    setIsIndexLoading(true);
    const res = await dms.indexDocument(state.selectedPath);
    setIsIndexLoading(false);
    if (res.ok) {
      const metaRes = await dms.getMetadata(state.selectedPath);
      if (metaRes.ok) dispatch({ type: "SET_METADATA", metadata: metaRes.data ?? null });
    } else {
      dispatch({ type: "SET_ERROR", error: res.error ?? "Indexing failed" });
    }
  };

  // Import a source file into the current zone workspace
  const doImport = async () => {
    if (!state.selectedPath || !state.zone) return;
    setIsImportLoading(true);
    const res = await dms.importToZone(state.selectedPath, state.zone.name);
    setIsImportLoading(false);
    if (res.ok && res.data) {
      dispatch({ type: "SET_VIEWER_PATH", path: res.data.dest ?? state.selectedPath });
      // Refresh to the zone workspace
      const scanRes = await dms.scanDir(state.zone.out_path);
      if (scanRes.ok && scanRes.data)
        dispatch({ type: "SET_ENTRIES", entries: scanRes.data.entries });
    } else {
      dispatch({ type: "SET_ERROR", error: res.error ?? "Import failed" });
    }
  };

  const doOcr = async () => {
    if (!state.viewerPath) return;
    setIsOcrLoading(true);
    const zoneName = state.zone?.name ?? "";
    const res = await dms.ocrDocument(state.viewerPath, zoneName);
    setIsOcrLoading(false);
    if (res.ok && res.data) {
      const quality = res.data.quality ?? "ok";
      setOcrQuality(quality);
      dispatch({ type: "SET_VIEWER_CONTENT", content: res.data.text });
      // Reload metadata — OCR now indexes the original file so get_metadata
      // returns keywords/snippet immediately and on every future re-open.
      const metaRes = await dms.getMetadata(state.viewerPath);
      dispatch({ type: "SET_METADATA", metadata: (metaRes.ok && metaRes.data) ? metaRes.data : null });
      if (zoneName && state.zone && state.currentPath === state.zone.out_path) {
        const scanRes = await dms.scanDir(state.currentPath);
        if (scanRes.ok && scanRes.data) dispatch({ type: "SET_ENTRIES", entries: scanRes.data.entries });
      }
    } else {
      dispatch({ type: "SET_ERROR", error: res.error ?? "OCR failed" });
    }
  };

  const doRectify = async () => {
    if (!state.viewerPath) return;
    setIsRectifyLoading(true);
    const res = await dms.rectifyDocument(state.viewerPath);
    setIsRectifyLoading(false);
    if (res.ok && res.data?.outPath) {
      dispatch({ type: "SET_VIEWER_PATH", path: res.data.outPath });
      const scanRes = await dms.scanDir(state.currentPath);
      if (scanRes.ok && scanRes.data) dispatch({ type: "SET_ENTRIES", entries: scanRes.data.entries });
    } else {
      dispatch({ type: "SET_ERROR", error: res.error ?? "Rectification failed" });
    }
  };

  const doExportPdf = async () => {
    if (!state.viewerPath) return;
    const src = state.viewerPath;
    const out = src.substring(0, src.lastIndexOf(".")) + ".pdf";
    setIsPdfExportLoading(true);
    const res = await dms.exportPdf(src, out);
    setIsPdfExportLoading(false);
    if (res.ok && res.data?.outPath) {
      dispatch({ type: "SET_VIEWER_PATH", path: res.data.outPath });
      const scanRes = await dms.scanDir(state.currentPath);
      if (scanRes.ok && scanRes.data) dispatch({ type: "SET_ENTRIES", entries: scanRes.data.entries });
    } else {
      dispatch({ type: "SET_ERROR", error: res.error ?? "PDF Export failed" });
    }
  };

  const doImageToSvg = async () => {
    setSvgFabExpanded(false);
    if (!state.viewerPath) return;
    setIsToSvgLoading(true);
    const res = await dms.imageToSvg(state.viewerPath, { palette: svgPalette as any });
    setIsToSvgLoading(false);
    if (res.ok && res.data?.outPath) {
      dispatch({ type: "SET_VIEWER_PATH", path: res.data.outPath });
      const scanRes = await dms.scanDir(state.currentPath);
      if (scanRes.ok && scanRes.data)
        dispatch({ type: "SET_ENTRIES", entries: scanRes.data.entries });
    } else {
      dispatch({ type: "SET_ERROR", error: res.error ?? "Image to SVG conversion failed" });
    }
  };

  const doImageToSvgPoly = async () => {
    setSvgFabExpanded(false);
    if (!state.viewerPath) return;
    setIsToSvgPolyLoading(true);
    const res = await dms.imageToSvgPoly(state.viewerPath, { palette: svgPalette as any });
    setIsToSvgPolyLoading(false);
    if (res.ok && res.data?.outPath) {
      dispatch({ type: "SET_VIEWER_PATH", path: res.data.outPath });
      const scanRes = await dms.scanDir(state.currentPath);
      if (scanRes.ok && scanRes.data)
        dispatch({ type: "SET_ENTRIES", entries: scanRes.data.entries });
    } else {
      dispatch({ type: "SET_ERROR", error: res.error ?? "Polygon SVG conversion failed" });
    }
  };

  const doImageToSvgTri = async () => {
    setSvgFabExpanded(false);
    if (!state.viewerPath) return;
    setIsToSvgTriLoading(true);
    const res = await dms.imageToSvgTri(state.viewerPath, { palette: svgPalette as any });
    setIsToSvgTriLoading(false);
    if (res.ok && res.data?.outPath) {
      dispatch({ type: "SET_VIEWER_PATH", path: res.data.outPath });
      const scanRes = await dms.scanDir(state.currentPath);
      if (scanRes.ok && scanRes.data)
        dispatch({ type: "SET_ENTRIES", entries: scanRes.data.entries });
    } else {
      dispatch({ type: "SET_ERROR", error: res.error ?? "Triangle SVG conversion failed" });
    }
  };

  if (!state.viewerPath && !state.selectedPath) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center p-8 bg-[var(--theme-bg)]">
        <Icon name="document" size="xl" className="opacity-20 text-[var(--theme-text)]" />
        <p className="text-[var(--theme-text-muted)] text-sm">Select a file to view it here</p>
      </div>
    );
  }

  // ── Shared media placeholder helpers ──────────────────────────────────────
  const MediaError = () => (
    <div className="w-full max-w-lg aspect-[3/4] flex flex-col items-center justify-center gap-4 p-12 rounded-lg border-2 border-dashed border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-text-muted)]">
      <Icon name={isPdf ? "document" : "image"} size="lg" className="opacity-20" />
      <div className="text-center">
        <p className="text-sm font-bold mb-1">Preview Failed</p>
        <p className="text-[10px] opacity-70">The file might be corrupted or in an unsupported format.</p>
      </div>
      <button
        onClick={() => setFetchKey(k => k + 1)}
        className="mt-2 text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded bg-[var(--theme-primary)]/10 hover:bg-[var(--theme-primary)]/20 text-[var(--theme-primary)] transition-colors"
      >
        Retry
      </button>
    </div>
  );



  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[var(--theme-bg)]">
      {/* File header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--theme-border)] bg-[var(--theme-surface)] shrink-0">
        <div className="w-8 h-8 flex items-center justify-center rounded bg-[var(--theme-bg)] text-[var(--theme-text-muted)]">
          <Icon name={(isAudio ? "music" : is3D ? "cube" : isSvg ? "image" : isImage ? "image" : isPdf ? "document" : isArchive ? "archive" : "file") as IconName} size="sm" />
        </div>
        <span className="text-sm text-[var(--theme-text)] truncate flex-1 font-mono">
          {state.viewerPath ?? state.selectedPath}
        </span>
        {/* Context-aware action: IMPORT when in source, INDEX when in workspace */}
        {isInZoneSource ? (
          /* ── IMPORT: copy source file into current zone ─── */
          <button
            onClick={doImport}
            disabled={isImportLoading}
            title={`Import into zone "${state.zone?.name}"`}
            className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 transition-colors shrink-0 border border-emerald-500/20 disabled:opacity-50"
          >
            {isImportLoading
              ? <span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
              : <Icon name="plus" size="xs" />}
            <span>{isImportLoading ? "Importing…" : "Import"}</span>
          </button>
        ) : (
          /* ── INDEX: smart-index in zone workspace or global ─── */
          <button
            onClick={smartIndex}
            disabled={isIndexLoading || isOcrLoading}
            title={isImage && !isSvg ? "OCR + Index this image" : "Index this file"}
            className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg bg-[var(--theme-primary)]/10 hover:bg-[var(--theme-primary)]/20 text-[var(--theme-primary)] transition-colors shrink-0 border border-[var(--theme-primary)]/20 disabled:opacity-50"
          >
            {(isIndexLoading || isOcrLoading)
              ? <span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
              : <Icon name={isImage && !isSvg ? "scan" : "sparkles"} size="xs" />}
            <span>
              {isIndexLoading ? "Indexing…"
               : isOcrLoading  ? "OCR…"
               : isImage && !isSvg ? "OCR + Index"
               : "Index"}
            </span>
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 relative bg-[var(--theme-bg)]">
        {is3D ? (
          /* ── 3D model viewer ───────────────────────────────────────── */
          <div className="flex flex-col items-center justify-center min-h-full h-full gap-2">
            <ThreeDViewer filePath={state.viewerPath!} className="w-full flex-1 min-h-[400px]" />
          </div>
        ) : isSvg ? (
          /* ── Inline SVG preview ────────────────────────────────────── */
          <div className="flex flex-col items-center justify-center min-h-full gap-4">
            {(svgError || svgSizeError) ? (
              <div className="w-full max-w-lg flex flex-col items-center justify-center gap-4 p-12 rounded-lg border-2 border-dashed border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-text-muted)]">
                <Icon name="image" size="lg" className="opacity-20" />
                <div className="text-center">
                  <p className="text-sm font-bold mb-1">{svgSizeError ? "SVG Too Large to Preview" : "SVG Preview Failed"}</p>
                  <p className="text-[10px] opacity-70">
                    {svgSizeError
                      ? `File exceeds ${settings.svgPreviewMaxBytes >= 1_048_576 ? (settings.svgPreviewMaxBytes / 1_048_576).toFixed(0) + " MB" : (settings.svgPreviewMaxBytes / 1024).toFixed(0) + " KB"} — too large for inline preview. Raise the limit in Theme & Settings → Settings tab, or open the file in an external SVG viewer.`
                      : "Could not load the file from the local scheme."}
                  </p>
                </div>
                {!svgSizeError && (
                  <button
                    onClick={() => { setSvgError(false); setSvgSizeError(false); setSvgMarkup(null); }}
                    className="text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded bg-[var(--theme-primary)]/10 hover:bg-[var(--theme-primary)]/20 text-[var(--theme-primary)] transition-colors"
                  >
                    Retry
                  </button>
                )}
              </div>
            ) : svgMarkup ? (
              <>
                {/* Inline SVG — centre it, cap its max size, let it scale */}
                <div
                  className="w-full max-w-3xl rounded-xl overflow-hidden border border-[var(--theme-border)] bg-[var(--theme-surface)] flex items-center justify-center p-6 shadow-2xl"
                  // dangerouslySetInnerHTML is safe here: scripts and event
                  // handlers are stripped by the sanitization step above.
                  dangerouslySetInnerHTML={{ __html: svgMarkup }}
                  style={{ minHeight: '200px' }}
                />
                <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--theme-text-muted)] text-center bg-[var(--theme-surface)]/50 px-4 py-2 rounded-full border border-[var(--theme-border)]">
                  Vector graphic — rendered inline
                </p>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <span className="w-6 h-6 border-2 border-[var(--theme-primary)]/20 border-t-[var(--theme-primary)] rounded-full animate-spin" />
                <span className="text-[var(--theme-text-muted)] text-[10px] font-bold uppercase tracking-widest">Loading SVG…</span>
              </div>
            )}
          </div>

        ) : isAudio ? (
          <div className="flex flex-col items-center gap-6 p-4 h-full">
            {isLargeAudio ? (
              /* ── Large audio: stream via native <audio> element ────────── */
              <div className="w-full max-w-xl flex flex-col gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-400 font-medium">
                  <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  Large file ({fileSizeBytes !== null ? `${(fileSizeBytes / 1048576).toFixed(0)} MB` : "?"}) — streaming playback (no spectrum visualiser)
                </div>
                <audio
                  key={(mediaSrc ?? "") + fetchKey}
                  src={mediaSrc ?? ""}
                  controls
                  onError={() => setAudioError("Audio could not be loaded — format may be unsupported")}
                  className="w-full rounded-lg"
                  style={{ colorScheme: "dark" }}
                />
                {audioError && (
                  <p className="text-[10px] text-[var(--theme-danger)] text-center">{audioError}</p>
                )}
              </div>
            ) : (
              /* ── Small/medium audio: Web Audio API with visualiser ──────── */
              <>
                <div className="w-full max-w-xl">
                  <SlidingAudioVisualizer
                    analyserNode={analyserNode}
                    visualizationData={visualizationData}
                    isPlaying={isPlaying}
                    width={480}
                    height={120}
                    className="mx-auto"
                  />
                </div>
                <div className="w-full max-w-xl h-36 rounded-lg overflow-hidden border border-[var(--theme-border)]">
                  <SpectrumAnalyzer
                    analyserNode={analyserNode}
                    isPlaying={isPlaying}
                    className="w-full h-full"
                  />
                </div>
                <div className="flex items-center gap-3">
                  {isPlaying ? (
                    <button
                      onClick={stop}
                      className="flex items-center gap-2 px-5 py-2 rounded-full bg-[var(--theme-danger)] hover:opacity-90 text-white text-xs font-bold uppercase tracking-wider transition-colors shadow-lg"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>
                      Stop
                    </button>
                  ) : (
                    <button
                      disabled={isAudioLoading}
                      onClick={() => {
                        if (!state.viewerPath || isAudioLoading) return;
                        setAudioError(null);
                        play(state.viewerPath, state.viewerPath).catch((e: unknown) => {
                          setAudioError(
                            (e instanceof Error ? e.message : String(e)) ||
                            "Playback failed — check the console for details"
                          );
                        });
                      }}
                      className="flex items-center gap-2 px-5 py-2 rounded-full bg-[var(--theme-primary)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed text-[var(--theme-bg)] text-xs font-bold uppercase tracking-wider transition-colors shadow-lg"
                    >
                      {isAudioLoading ? (
                        <>
                          <span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                          Loading…
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>
                          Play
                        </>
                      )}
                    </button>
                  )}
                </div>
                {audioError && (
                  <div className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--theme-danger)]/40 bg-[var(--theme-danger)]/10 text-[var(--theme-danger)] text-[10px] font-medium max-w-sm text-center">
                    <span>⚠ {audioError}</span>
                  </div>
                )}
              </>
            )}
            <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--theme-text-muted)] text-center bg-[var(--theme-surface)]/50 px-4 py-2 rounded-full border border-[var(--theme-border)]">
              Audio file
            </p>
          </div>

        ) : isVideo ? (
          /* ── Video player — custom, ref-controlled for immediate pause ── */
          <div className="flex flex-col items-center justify-center min-h-full gap-4 p-4">
            <VideoPlayer
              src={mediaSrc ?? ""}
              className="w-full max-w-4xl max-h-[75vh]"
            />
            <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--theme-text-muted)] text-center bg-[var(--theme-surface)]/50 px-4 py-2 rounded-full border border-[var(--theme-border)]">
              Video — Space to play/pause · ← → seek 5s · F fullscreen · M mute
            </p>
          </div>

        ) : isArchive ? (
          /* ── Archive info panel ──────────────────────────────────────── */
          <div className="flex flex-col items-center justify-center min-h-full gap-4 p-8">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
              <Icon name="archive" size="xl" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-semibold text-[var(--theme-text)]">
                {state.viewerPath?.split("/").pop()}
              </p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)]">
                Archive · select Index to register in DB
              </p>
            </div>
            <button
              onClick={smartIndex}
              className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg bg-[var(--theme-primary)]/10 hover:bg-[var(--theme-primary)]/20 text-[var(--theme-primary)] transition-colors border border-[var(--theme-primary)]/20"
            >
              <Icon name="sparkles" size="xs" />
              Register in DB
            </button>
            <p className="text-[9px] text-[var(--theme-text-muted)] text-center max-w-xs opacity-70">
              Archives are not previewed inline. Use a dedicated tool to extract contents.
              File stats are shown in the Analyze panel.
            </p>
          </div>

        ) : isImage ? (
        <div className="flex flex-col items-center justify-center min-h-full gap-6 group">
          <div className="relative">
            {mediaError ? <MediaError /> : (
              <img
                key={(mediaSrc ?? "") + fetchKey}
                src={mediaSrc ?? ""}
                alt={state.viewerPath ?? ""}
                onError={() => setMediaError(true)}
                className="max-w-full max-h-[75vh] object-contain rounded-lg border border-[var(--theme-border)] shadow-2xl bg-[var(--theme-surface)] transition-all duration-300"
              />
            )}

              {/* Floating FAB Group — atomic: all buttons w-9 h-9, theme-aware colours */}
              {!mediaError && (
                <div className={`absolute top-1/2 -translate-y-1/2 flex flex-col gap-1.5 transition-all duration-300 ease-out ${
                  svgFabExpanded
                    ? "opacity-100 right-3 pointer-events-auto"
                    : "opacity-0 -right-10 group-hover:opacity-100 group-hover:right-3 pointer-events-none group-hover:pointer-events-auto"
                }`}>
                  {/* OCR — primary variant: white icon → sharp black inverse shadow */}
                  <button onClick={doOcr} disabled={isOcrLoading} title="OCR: Extract Text"
                    className="w-9 h-9 rounded-full shadow-[0_4px_16px_rgba(0,0,0,0.6),0_1px_3px_rgba(0,0,0,0.4)] flex items-center justify-center transition-all duration-150 hover:scale-110 active:scale-95 disabled:opacity-50 bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] hover:opacity-90">
                    {isOcrLoading
                      ? <span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                      : <Icon name="scan" size="sm" className="drop-shadow-[0_1px_1px_rgba(0,0,0,1)]" />}
                  </button>
                  {/* Rectify — secondary variant */}
                  <button onClick={doRectify} disabled={isRectifyLoading} title="Crop & Deskew (Rectify)"
                    className="w-9 h-9 rounded-full shadow-[0_4px_16px_rgba(0,0,0,0.6),0_1px_3px_rgba(0,0,0,0.4)] flex items-center justify-center transition-all duration-150 hover:scale-110 active:scale-95 disabled:opacity-50 bg-[var(--theme-surface)] border border-[var(--theme-border)] text-[var(--theme-text)] hover:bg-[var(--theme-bg)]">
                    {isRectifyLoading
                      ? <span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                      : <Icon name="scissors" size="sm" />}
                  </button>
                  {/* Export PDF — secondary variant */}
                  <button onClick={doExportPdf} disabled={isPdfExportLoading} title="Export to PDF"
                    className="w-9 h-9 rounded-full shadow-[0_4px_16px_rgba(0,0,0,0.6),0_1px_3px_rgba(0,0,0,0.4)] flex items-center justify-center transition-all duration-150 hover:scale-110 active:scale-95 disabled:opacity-50 bg-[var(--theme-surface)] border border-[var(--theme-border)] text-[var(--theme-text)] hover:bg-[var(--theme-bg)]">
                    {isPdfExportLoading
                      ? <span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                      : <Icon name="print" size="sm" />}
                  </button>
                  {/* Palette picker — compact, shown always in the FAB column */}
                  <select
                    value={svgPalette}
                    onChange={e => setSvgPalette(e.target.value)}
                    title="SVG colour palette"
                    className="w-9 h-9 rounded-full text-[8px] font-black bg-[var(--theme-surface)] border border-[var(--theme-border)] text-[var(--theme-text)] cursor-pointer shadow-[0_4px_16px_rgba(0,0,0,0.6),0_1px_3px_rgba(0,0,0,0.4)] appearance-none text-center px-0"
                    style={{ writingMode: 'horizontal-tb' }}
                  >
                    <option value="db8">DB8</option>
                    <option value="db16">DB16</option>
                    <option value="db32">DB32</option>
                    <option value="spectrum14">SP14</option>
                    <option value="spectrum16">SP16</option>
                    <option value="auto8">A8</option>
                    <option value="auto16">A16</option>
                    <option value="auto32">A32</option>
                  </select>
                  {/* SVG toggle — accent variant, click to open/close sub-options */}
                  <button
                    onClick={() => setSvgFabExpanded(e => !e)}
                    title={svgFabExpanded ? "Close SVG options" : "Convert to SVG…"}
                    className="w-9 h-9 rounded-full shadow-[0_4px_16px_rgba(0,0,0,0.6),0_1px_3px_rgba(0,0,0,0.4)] flex items-center justify-center transition-all duration-150 hover:scale-110 active:scale-95 bg-[var(--theme-primary)]/40 border-2 border-[var(--theme-primary)]/70 text-[var(--theme-primary)] hover:bg-[var(--theme-primary)]/55"
                  >
                    {svgFabExpanded ? (
                      <svg className="w-4 h-4 drop-shadow-[0_1px_1px_rgba(255,255,255,0.9)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M18 6 6 18M6 6l12 12"/>
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 drop-shadow-[0_1px_1px_rgba(255,255,255,0.9)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 12l5-7h10l5 7-5 7H7z"/>
                      </svg>
                    )}
                  </button>
                  {/* SVG sub-options — RCT (primary filled) and PLY (primary outlined) */}
                  {svgFabExpanded && (
                    <>
                      {/* RCT — primary filled: white label → sharp black inverse shadow */}
                      <button
                        onClick={doImageToSvg}
                        disabled={isToSvgLoading}
                        title="SVG Rects — saves as {name}_rct.svg"
                        className="w-9 h-9 rounded-full shadow-[0_4px_16px_rgba(0,0,0,0.6),0_1px_3px_rgba(0,0,0,0.4)] flex items-center justify-center transition-all duration-150 hover:scale-110 active:scale-95 disabled:opacity-50 bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] hover:opacity-90"
                      >
                        {isToSvgLoading
                          ? <span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                          : <span className="text-[8px] font-black tracking-tight leading-none" style={{ textShadow: '0 1px 1px rgba(0,0,0,1), -1px 0 1px rgba(0,0,0,0.7)' }}>RCT</span>}
                      </button>
                      {/* PLY — solid surface bg + thick border: primary label → sharp white inverse shadow */}
                      <button
                        onClick={doImageToSvgPoly}
                        disabled={isToSvgPolyLoading}
                        title="SVG Polygons — saves as {name}_ply.svg"
                        className="w-9 h-9 rounded-full shadow-[0_4px_16px_rgba(0,0,0,0.6),0_1px_3px_rgba(0,0,0,0.4)] flex items-center justify-center transition-all duration-150 hover:scale-110 active:scale-95 disabled:opacity-50 bg-[var(--theme-surface)] border-2 border-[var(--theme-primary)] text-[var(--theme-primary)] hover:bg-[var(--theme-primary)]/15"
                      >
                        {isToSvgPolyLoading
                          ? <span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                          : <span className="text-[8px] font-black tracking-tight leading-none" style={{ textShadow: '0 1px 1px rgba(255,255,255,0.9), -1px 0 1px rgba(255,255,255,0.7)' }}>PLY</span>}
                      </button>
                      {/* TRI — solid surface bg + thick border: primary label → sharp white inverse shadow */}
                      <button
                        onClick={doImageToSvgTri}
                        disabled={isToSvgTriLoading}
                        title="SVG Triangles — saves as {name}_tri.svg"
                        className="w-9 h-9 rounded-full shadow-[0_4px_16px_rgba(0,0,0,0.6),0_1px_3px_rgba(0,0,0,0.4)] flex items-center justify-center transition-all duration-150 hover:scale-110 active:scale-95 disabled:opacity-50 bg-[var(--theme-surface)] border-2 border-[var(--theme-primary)] text-[var(--theme-primary)] hover:bg-[var(--theme-primary)]/15"
                      >
                        {isToSvgTriLoading
                          ? <span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                          : <span className="text-[8px] font-black tracking-tight leading-none" style={{ textShadow: '0 1px 1px rgba(255,255,255,0.9), -1px 0 1px rgba(255,255,255,0.7)' }}>TRI</span>}
                      </button>
                    </>
                  )}
                  {/* Privacy — secondary variant */}
                  <button title="Analyze Privacy"
                    className="w-9 h-9 rounded-full shadow-[0_4px_16px_rgba(0,0,0,0.6),0_1px_3px_rgba(0,0,0,0.4)] flex items-center justify-center transition-all duration-150 hover:scale-110 active:scale-95 bg-[var(--theme-surface)] border border-[var(--theme-border)] text-[var(--theme-text)] hover:bg-[var(--theme-bg)]">
                    <Icon name="shield" size="sm" />
                  </button>
                </div>
              )}
            </div>

            <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--theme-text-muted)] text-center max-w-sm bg-[var(--theme-surface)]/50 px-4 py-2 rounded-full border border-[var(--theme-border)]">
              Image detected. Use <strong>OCR</strong> to extract text or <strong>Index</strong> to vectorize.
            </p>
          </div>

        ) : isPdf ? (
          <div className="w-full h-full flex flex-col rounded-lg overflow-hidden border border-[var(--theme-border)]">
            {mediaError ? (
              <div className="flex-1 flex items-center justify-center bg-[var(--theme-surface)]">
                <MediaError />
              </div>
            ) : (
              <object
                key={(mediaSrc ?? "") + fetchKey}
                data={mediaSrc ?? ""}
                type="application/pdf"
                className="w-full flex-1 min-h-0"
                style={{ height: "100%" }}
              >
                <p className="p-4 text-sm text-[var(--theme-text-muted)]">
                  PDF preview not available.{" "}
                  <button onClick={() => setFetchKey(k => k + 1)} className="text-[var(--theme-primary)] underline">Retry</button>
                </p>
              </object>
            )}
          </div>

        ) : state.viewerContent ? (
          <div className="max-w-4xl mx-auto">
            {ocrQuality && ocrQuality !== "ok" && (
              <div className={`flex items-center gap-2 mb-3 px-3 py-2 rounded-lg border text-xs font-medium ${
                ocrQuality === "garbage"
                  ? "bg-red-500/10 border-red-500/30 text-red-500"
                  : "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400"
              }`}>
                <Icon name="warning" size="xs" />
                <span>
                  {ocrQuality === "garbage"
                    ? "OCR quality is very low — this image likely contains charts, diagrams, or non-text content. Results may be unreliable."
                    : "OCR confidence is low — some words may be misread. Review before saving."}
                </span>
              </div>
            )}
            <pre className="text-sm text-[var(--theme-text)] font-mono whitespace-pre-wrap break-words leading-relaxed bg-[var(--theme-surface)] p-6 rounded-xl border border-[var(--theme-border)] shadow-sm">
              {state.viewerContent}
            </pre>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <span className="w-6 h-6 border-2 border-[var(--theme-primary)]/20 border-t-[var(--theme-primary)] rounded-full animate-spin" />
            <span className="text-[var(--theme-text-muted)] text-[10px] font-bold uppercase tracking-widest">Loading Content…</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default DocumentViewer;
