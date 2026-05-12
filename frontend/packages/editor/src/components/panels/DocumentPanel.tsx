import React, { useState, useEffect } from "react";
import { useEditor } from "../../store/editor-store";
import { type PageSize, type PageOrientation, type SpacingToken, type SPageBackground } from "../../models/sdm";
import { type DocumentIntent, DOCUMENT_INTENT_META } from "../../models/editor-context";
import { useDocumentStats } from "../../hooks/useDocumentStats";
import { resolvePageBackgroundCss } from "../../services/page-background";
import { slugifyDocumentFilename } from "../../models/document-meta";

const PAGE_SIZES: PageSize[] = ["a4", "a5", "a3", "a6", "a0", "a1", "a2", "letter", "legal"];
const SPACING_TOKENS: SpacingToken[] = ["none", "xs", "sm", "md", "lg", "xl", "2xl"];
const SOLID_BACKGROUNDS: Array<{ label: string; value: string }> = [
  { label: "White", value: "#ffffff" },
  { label: "Warm Paper", value: "#faf7f2" },
  { label: "Cream", value: "#fffef0" },
  { label: "Slate", value: "#f0f4f8" },
  { label: "Night", value: "#1a1a2e" },
  { label: "Ink", value: "#0f172a" },
  { label: "Transparent", value: "transparent" },
];
const GRADIENT_BACKGROUNDS: Array<{ label: string; value: SPageBackground }> = [
  {
    label: "Ivory Wash",
    value: { gradient: { type: "linear", angle: 180, stops: [{ color: "#fffdf8", position: 0 }, { color: "#f5efe3", position: 100 }] } },
  },
  {
    label: "Cool Mist",
    value: { gradient: { type: "linear", angle: 160, stops: [{ color: "#ffffff", position: 0 }, { color: "#e8eef7", position: 100 }] } },
  },
  {
    label: "Studio Dusk",
    value: { gradient: { type: "linear", angle: 145, stops: [{ color: "#f7f1e8", position: 0 }, { color: "#e7ddff", position: 100 }] } },
  },
];

const INPUT_CLASS =
  "w-full rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] text-[11px] px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]";
const SELECT_CLASS =
  "w-full rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] text-[11px] px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[8px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60">
        {label}
      </label>
      {children}
    </div>
  );
}

function hasGradient(background?: SPageBackground): boolean {
  return Boolean(background?.gradient?.type === "linear");
}

function sameGradientPreset(left: SPageBackground | undefined, right: SPageBackground): boolean {
  const a = left?.gradient;
  const b = right.gradient;
  if (!a || !b || a.type !== "linear" || b.type !== "linear" || a.angle !== b.angle) return false;
  if (a.stops.length !== b.stops.length) return false;
  return a.stops.every((stop, index) => {
    const other = b.stops[index];
    return Boolean(other && other.color === stop.color && other.position === stop.position);
  });
}

export function DocumentPanel() {
  const { state, dispatch } = useEditor();
  const { doc, intent } = state;

  const [localTitle, setLocalTitle] = useState(doc?.meta.title ?? "");
  const [localFilename, setLocalFilename] = useState(doc?.meta.filename ?? "");

  // Sync inputs when document identity changes (e.g. new doc loaded).
  useEffect(() => {
    setLocalTitle(doc?.meta.title ?? "");
    setLocalFilename(doc?.meta.filename ?? "");
  }, [doc?.id, doc?.meta.title, doc?.meta.filename]);

  const stats = useDocumentStats(doc);

  if (!doc || !stats) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--theme-text-muted)] opacity-50 p-4">
        <span className="text-[9px] font-medium uppercase tracking-wide">No document loaded</span>
      </div>
    );
  }

  const intentMeta = DOCUMENT_INTENT_META[intent];

  return (
    <div className="flex flex-col h-full overflow-hidden text-[var(--theme-text)]">
      <div className="px-2 py-1.5 border-b border-[var(--theme-border)] shrink-0 bg-[var(--theme-bg)]/40">
        <span className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-70">
          Document
        </span>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-[var(--theme-border)]">
        {/* Identity */}
        <div className="px-2 py-2 space-y-2">
          <Row label="Title">
            <input
              type="text"
              value={localTitle}
              onChange={(e) => setLocalTitle(e.target.value)}
              onBlur={(e) => {
                const previousTitle = (doc.meta.title ?? "").trim();
                const nextTitle = e.target.value.trim();
                const currentFilename = doc.meta.filename ?? "";
                const autoFilename = slugifyDocumentFilename(previousTitle);
                const shouldFollowTitle = !currentFilename || currentFilename === autoFilename;
                const nextFilename = shouldFollowTitle ? slugifyDocumentFilename(nextTitle) : currentFilename;

                setLocalTitle(nextTitle);
                if (shouldFollowTitle) setLocalFilename(nextFilename);

                if (nextTitle !== previousTitle || nextFilename !== currentFilename) {
                  dispatch({
                    type: "UPDATE_META",
                    meta: {
                      title: nextTitle,
                      ...(shouldFollowTitle ? { filename: nextFilename } : {}),
                    },
                  });
                }
              }}
              className={INPUT_CLASS}
              placeholder="Document title…"
            />
          </Row>

          <Row label="Filename">
            <input
              type="text"
              value={localFilename}
              onChange={(e) => setLocalFilename(e.target.value)}
              onBlur={(e) => {
                const nextFilename = slugifyDocumentFilename(e.target.value);
                setLocalFilename(nextFilename);
                if (nextFilename !== (doc.meta.filename ?? "")) {
                  dispatch({ type: "UPDATE_META", meta: { filename: nextFilename } });
                }
              }}
              className={INPUT_CLASS}
              placeholder="document.pdf"
            />
          </Row>

          {doc.meta.author && (
            <Row label="Author">
              <span className="text-[11px] text-[var(--theme-text-muted)] px-1">
                {doc.meta.author}
              </span>
            </Row>
          )}
        </div>

        {/* Intent */}
        <div className="px-2 py-2 space-y-2">
          <Row label="Document Type">
            <select
              value={intent}
              onChange={(e) =>
                dispatch({ type: "SET_INTENT", intent: e.target.value as DocumentIntent })
              }
              className={SELECT_CLASS}
            >
              {Object.values(DOCUMENT_INTENT_META).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Row>
          {intentMeta && (
            <p className="text-[8px] text-[var(--theme-text-muted)] opacity-50 leading-snug">
              {intentMeta.description}
            </p>
          )}
        </div>

        {/* Page settings */}
        <div className="px-2 py-2 space-y-2">
          <Row label="Page Size">
            <select
              value={doc.page.size}
              onChange={(e) =>
                dispatch({ type: "UPDATE_PAGE", page: { size: e.target.value as PageSize } })
              }
              className={SELECT_CLASS}
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s.toUpperCase()}
                </option>
              ))}
            </select>
          </Row>

          <Row label="Orientation">
            <div className="flex rounded border border-[var(--theme-border)] overflow-hidden text-[9px]">
              {(["portrait", "landscape"] as PageOrientation[]).map((o) => (
                <button
                  key={o}
                  onClick={() =>
                    dispatch({ type: "UPDATE_PAGE", page: { orientation: o } })
                  }
                  className={[
                    "flex-1 py-1 capitalize transition-colors",
                    doc.page.orientation === o
                      ? "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] font-bold"
                      : "hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)]",
                  ].join(" ")}
                >
                  {o}
                </button>
              ))}
            </div>
          </Row>

          <Row label="Page Margin">
            <select
              value={doc.page.margin}
              onChange={(e) =>
                dispatch({ type: "UPDATE_PAGE", page: { margin: e.target.value as SpacingToken } })
              }
              className={SELECT_CLASS}
            >
              {SPACING_TOKENS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Row>

          <Row label="Page Numbers">
            <button
              onClick={() =>
                dispatch({
                  type: "UPDATE_PAGE",
                  page: { showPageNumbers: !doc.page.showPageNumbers },
                })
              }
              title="Print a page counter in the PDF footer (requires WebKit ≥ 2022 or Chromium ≥ 119)"
              className={[
                "w-full py-1 rounded border text-[9px] font-bold transition-colors",
                doc.page.showPageNumbers
                  ? "bg-[var(--theme-primary)] border-[var(--theme-primary)] text-[var(--theme-primary-fg)]"
                  : "border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:border-[var(--theme-primary)]/50",
              ].join(" ")}
            >
              {doc.page.showPageNumbers ? "On" : "Off"}
            </button>
          </Row>
        </div>

        {/* Background */}
        <div className="px-2 py-2 space-y-2">
          <div className="text-[8px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 mb-1.5">
            Background
          </div>

          <div
            className="rounded border border-[var(--theme-border)] h-14"
            style={{ background: resolvePageBackgroundCss(doc.page.background) }}
          />

          <Row label="Background Mode">
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() =>
                  dispatch({
                    type: "UPDATE_PAGE",
                    page: { background: { color: doc.page.background?.color ?? "#ffffff" } } as Partial<import("../../models/sdm").SPageConfig>,
                  })
                }
                className={[
                  "py-1 rounded border text-[9px] font-bold transition-colors",
                  !hasGradient(doc.page.background)
                    ? "bg-[var(--theme-primary)] border-[var(--theme-primary)] text-[var(--theme-primary-fg)]"
                    : "border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:border-[var(--theme-primary)]/50",
                ].join(" ")}
              >
                Solid
              </button>
              <button
                onClick={() =>
                  dispatch({
                    type: "UPDATE_PAGE",
                    page: { background: doc.page.background?.gradient ? doc.page.background : (GRADIENT_BACKGROUNDS[0]?.value ?? { gradient: { type: "linear", angle: 180, stops: [{ color: "#fffdf8", position: 0 }, { color: "#f5efe3", position: 100 }] } }) } as Partial<import("../../models/sdm").SPageConfig>,
                  })
                }
                className={[
                  "py-1 rounded border text-[9px] font-bold transition-colors",
                  hasGradient(doc.page.background)
                    ? "bg-[var(--theme-primary)] border-[var(--theme-primary)] text-[var(--theme-primary-fg)]"
                    : "border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:border-[var(--theme-primary)]/50",
                ].join(" ")}
              >
                Gradient
              </button>
            </div>
          </Row>

          {!hasGradient(doc.page.background) ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {SOLID_BACKGROUNDS.map(({ label, value }) => (
                  <button
                    key={value}
                    title={label}
                    onClick={() =>
                      dispatch({
                        type: "UPDATE_PAGE",
                        page: {
                          background: value === "transparent"
                            ? { color: "transparent" }
                            : { color: value },
                        } as Partial<import("../../models/sdm").SPageConfig>,
                      })
                    }
                    className={[
                      "w-6 h-6 rounded border transition-transform hover:scale-110",
                      (doc.page.background?.color ?? "#ffffff") === value
                        ? "border-[var(--theme-primary)] ring-1 ring-[var(--theme-primary)]"
                        : "border-[var(--theme-border)]",
                      value === "transparent"
                        ? "bg-[repeating-conic-gradient(#ccc_0%_25%,white_0%_50%)] bg-[length:8px_8px]"
                        : "",
                    ].join(" ")}
                    style={value !== "transparent" ? { backgroundColor: value } : {}}
                  />
                ))}
              </div>

              <Row label="Custom Color">
                <div className="flex gap-1.5 items-center">
                  <input
                    type="color"
                    value={
                      doc.page.background?.color?.startsWith("#")
                        ? doc.page.background.color
                        : "#ffffff"
                    }
                    onChange={(e) =>
                      dispatch({
                        type: "UPDATE_PAGE",
                        page: { background: { color: e.target.value } } as Partial<import("../../models/sdm").SPageConfig>,
                      })
                    }
                    className="w-7 h-7 rounded border border-[var(--theme-border)] cursor-pointer p-0.5 bg-transparent"
                    title="Pick background color"
                  />
                  <input
                    type="text"
                    value={doc.page.background?.color ?? ""}
                    onChange={(e) =>
                      dispatch({
                        type: "UPDATE_PAGE",
                        page: { background: { color: e.target.value } } as Partial<import("../../models/sdm").SPageConfig>,
                      })
                    }
                    placeholder="#ffffff or rgba(…)"
                    className={INPUT_CLASS}
                  />
                  {doc.page.background?.color && (
                    <button
                      onClick={() =>
                        dispatch({
                          type: "UPDATE_PAGE",
                          page: { background: undefined } as unknown as Partial<import("../../models/sdm").SPageConfig>,
                        })
                      }
                      title="Reset to white"
                      className="shrink-0 text-[9px] text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)] transition-colors"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </Row>
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {GRADIENT_BACKGROUNDS.map(({ label, value }) => (
                  <button
                    key={label}
                    title={label}
                    onClick={() =>
                      dispatch({
                        type: "UPDATE_PAGE",
                        page: { background: value } as Partial<import("../../models/sdm").SPageConfig>,
                      })
                    }
                    className={[
                      "w-10 h-6 rounded border transition-transform hover:scale-105",
                      sameGradientPreset(doc.page.background, value)
                        ? "border-[var(--theme-primary)] ring-1 ring-[var(--theme-primary)]"
                        : "border-[var(--theme-border)]",
                    ].join(" ")}
                    style={{ background: resolvePageBackgroundCss(value) }}
                  />
                ))}
              </div>

              <Row label="Gradient Angle">
                <input
                  type="range"
                  min={0}
                  max={360}
                  step={1}
                  value={doc.page.background?.gradient?.angle ?? 135}
                  onChange={(e) =>
                    dispatch({
                      type: "UPDATE_PAGE",
                      page: {
                        background: {
                          ...doc.page.background,
                          gradient: {
                            type: "linear",
                            angle: Number(e.target.value),
                            stops: doc.page.background?.gradient?.stops ?? [
                              { color: "#fffdf8", position: 0 },
                              { color: "#f5efe3", position: 100 },
                            ],
                          },
                        },
                      } as Partial<import("../../models/sdm").SPageConfig>,
                    })
                  }
                />
              </Row>
            </>
          )}
        </div>

        {/* Quick stats */}
        <div className="px-2 py-2">
          <div className="text-[8px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 mb-1.5">
            Quick Stats
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { label: "Blocks", value: stats.blockCount },
              { label: "Words", value: stats.wordCount },
              { label: "Chars", value: stats.charCount },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2 py-1.5 text-center"
              >
                <div className="text-[8px] text-[var(--theme-text-muted)] opacity-60 uppercase">
                  {label}
                </div>
                <div className="text-xs font-black text-[var(--theme-text)] tabular-nums">
                  {value.toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tags */}
        {doc.meta.tags && doc.meta.tags.length > 0 && (
          <div className="px-2 py-2">
            <div className="text-[8px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 mb-1.5">
              Tags
            </div>
            <div className="flex flex-wrap gap-1">
              {doc.meta.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--theme-primary)]/10 text-[var(--theme-primary)] border border-[var(--theme-primary)]/20"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
