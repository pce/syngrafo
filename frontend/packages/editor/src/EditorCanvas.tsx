import React, { useRef } from "react";
import { useEditor, useEditorDoc } from "./store/editor-store";
import { PAGE_SIZE_MM } from "./models/sdm";
import type { SpacingToken } from "./models/sdm";
import { BlockView } from "./components/blocks/BlockView";
import { Icon } from "./components/Icon";
import { resolvePageBackgroundCss } from "./services/page-background";

const MM_TO_PX = 96 / 25.4; // 1 CSS px = 1/96 inch; 1 mm = 1/25.4 inch

const MARGIN_MM: Record<SpacingToken, number> = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  "2xl": 48,
};





/**
 * Visual page-boundary ruler shown inside the canvas page div.
 * Hidden in print / during PDF export via the sgf-page-ruler class.
 * topMm    – distance from the TOP of the page border-box (i.e. n × pageHeightMm)
 * pageNum  – the number of the page that starts after this ruler
 * marginMm – page margin in mm, used to extend the line into the margin areas
 */
function PageRuler({
  topMm,
  pageNum,
  marginMm,
}: {
  topMm: number;
  pageNum: number;
  marginMm: number;
}) {
  return (
    <div
      className="sgf-page-ruler"
      aria-hidden="true"
      style={{
        position:      "absolute",
        top:           `${topMm}mm`,
        left:          `-${marginMm}mm`,
        right:         `-${marginMm}mm`,
        height:        0,
        overflow:      "visible",
        pointerEvents: "none",
        userSelect:    "none",
        zIndex:        10,
      }}
    >
      {/* Dashed separator line */}
      <div
        style={{
          position:  "absolute",
          top:       "-1px",
          left:      0,
          right:     0,
          borderTop: "1.5px dashed rgba(99,102,241,0.4)",
        }}
      />
      {/* Page-number badge sits in the right margin, above the line */}
      <div
        style={{
          position:     "absolute",
          top:          "-10px",
          right:        `${Math.ceil(marginMm / 3)}mm`,
          fontSize:     "9px",
          lineHeight:   "16px",
          fontFamily:   "ui-monospace, monospace",
          color:        "rgba(99,102,241,0.75)",
          background:   "rgba(255,255,255,0.95)",
          padding:      "0 5px",
          borderRadius: "3px",
          border:       "1px solid rgba(99,102,241,0.25)",
          boxShadow:    "0 1px 3px rgba(0,0,0,0.06)",
          whiteSpace:   "nowrap",
        }}
      >
        Page {pageNum}
      </div>
    </div>
  );
}



export function EditorCanvas({ showRulers = true }: { showRulers?: boolean }): React.ReactElement {
  const { state, dispatch } = useEditor();
  const doc = useEditorDoc();
  const containerRef = useRef<HTMLDivElement>(null);

  const { selectedBlockId } = state;
  const { page, blocks, styles } = doc;

  /// Resolve page dimensions (swap for landscape).
  const baseSize = PAGE_SIZE_MM[page.size];
  const { w, h } =
    page.orientation === "landscape"
      ? { w: baseSize.h, h: baseSize.w }
      : baseSize;
  const marginMm = MARGIN_MM[page.margin] ?? 16;

  /// Ref to the page element, used to measure its height.
  const pageRef = useRef<HTMLDivElement>(null);
  const [pageBorderBoxHeightPx, setPageBorderBoxHeightPx] = React.useState(0);

  React.useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const bbs = entries[0]?.borderBoxSize?.[0];
      setPageBorderBoxHeightPx(bbs ? bbs.blockSize : el.offsetHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /// Each ruler marks the boundary between page N and page N+1.
  /// Stay on page 1 until content measurably exceeds a full page; otherwise an
  /// exact one-page layout would incorrectly announce a second page.
  const pageHeightPx = h * MM_TO_PX;
  const numRulers = showRulers
    ? Math.max(0, Math.ceil((pageBorderBoxHeightPx - pageHeightPx - 0.5) / pageHeightPx))
    : 0;
  const rulerPositions = Array.from({ length: numRulers }, (_, i) => ({
    topMm:   (i + 1) * h,
    pageNum: i + 2,
  }));

  /*
   * Dynamic @page CSS — sets the page size to match the document config and
   * injects a page counter into the bottom-right margin box of each PDF page.
   *
   * @page rules only fire during a print operation — saucer_pdf triggers this
   * via the platform-native API on every supported target:
   *   macOS   → WKWebView  printOperationWithPrintInfo (NSPrintOperation)
   *   Windows → WebView2   ICoreWebView2::PrintToPdf
   *   Linux   → WebKitGTK  webkit_print_operation_print
   *   Qt      → QWebEnginePage::printToPdf
   * The rule is silently ignored during normal on-screen rendering.
   *
   * Note: @page margin-box content (e.g. @bottom-right page counter) is part
   * of CSS Generated Content for Paged Media.  WebKit/WKWebView and recent
   * Chromium (≥ 119, Nov 2023) support it; older Chromium-based backends
   * (WebView2, Qt WebEngine < 6.7) will silently omit the counter — the rest
   * of the PDF layout is unaffected.
   */
  const pageCss = React.useMemo(() => {
    const pageCounter = page.showPageNumbers
      ? `
  @bottom-right {
    content: counter(page);
    font-size: 8pt;
    font-family: sans-serif;
    color: rgba(0, 0, 0, 0.45);
    margin-right: ${marginMm}mm;
     margin-bottom: ${Math.round(marginMm / 2)}mm;
   }`
      : "";
    return `\n@page {\n  size: ${w}mm ${h}mm;${pageCounter}\n}`;
  }, [w, h, marginMm, page.showPageNumbers]);

  return (
    <>
      <style>{pageCss}</style>
      <div
        ref={containerRef}
        className="sgf-canvas-outer flex-1 min-h-0 overflow-y-auto bg-[var(--theme-bg)]"
      >
        <div
          ref={pageRef}
          className="sgf-canvas-page mx-auto my-8 text-black shadow-lg rounded-sm"
          style={{
            position:    "relative",
            width:       `${w}mm`,
            minHeight:   `${h}mm`,
            padding:     `${marginMm}mm`,
            boxSizing:   "border-box",
            fontSize:    "14px",
            lineHeight:  "1.6",
            // Background: explicit color or white. transparent is useful for
            // screen overlays; WebkitPrintColorAdjust makes it print correctly.
            background:                resolvePageBackgroundCss(page.background),
            WebkitPrintColorAdjust:    "exact",
            printColorAdjust:          "exact",
          } as React.CSSProperties}
          onClick={(e) => {
            // Deselect if the click landed directly on the page background
            if (!(e.target as HTMLElement).closest("[data-block-id]")) {
              dispatch({ type: "SELECT_BLOCK", id: null });
            }
          }}
        >
          {blocks.length === 0 ? (
            <div
              tabIndex={0}
              role="button"
              className="flex flex-col items-center justify-center h-48 gap-2 cursor-text focus:outline-none"
              style={{ color: "#ccc" }}
              onClick={() => {
                const newBlock = { ...blocks[0] ?? { type: "p", spans: [] }, id: crypto.randomUUID() };
                dispatch({ type: "ADD_BLOCK", block: newBlock as any });
                requestAnimationFrame(() => {
                  const el = document.querySelector(`[data-block-id="${newBlock.id}"] [contenteditable]`) as HTMLElement | null;
                  el?.focus();
                });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || (e.key.length === 1 && !e.metaKey && !e.ctrlKey)) {
                  e.preventDefault();
                  const newBlock = { type: "p", spans: [{ text: e.key.length === 1 ? e.key : "" }], id: crypto.randomUUID() };
                  dispatch({ type: "ADD_BLOCK", block: newBlock as any });
                  requestAnimationFrame(() => {
                    const el = document.querySelector(`[data-block-id="${newBlock.id}"] [contenteditable]`) as HTMLElement | null;
                    if (el) {
                      el.focus();
                      // Move caret to end
                      const sel = window.getSelection();
                      const range = document.createRange();
                      range.selectNodeContents(el);
                      range.collapse(false);
                      sel?.removeAllRanges();
                      sel?.addRange(range);
                    }
                  });
                }
              }}
            >
              <Icon name="layout" size="xl" />
              <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>
                Start typing or add a block
              </span>
            </div>
          ) : (
            blocks.map((b) => (
              <BlockView
                key={b.id}
                block={b}
                selected={b.id === selectedBlockId}
                styles={styles}
                dispatch={dispatch}
              />
            ))
          )}

          {/* Automatic page-boundary rulers */}
          {rulerPositions.map(({ topMm, pageNum }) => (
            <PageRuler
              key={pageNum}
              topMm={topMm}
              pageNum={pageNum}
              marginMm={marginMm}
            />
          ))}
        </div>
      </div>
    </>
  );
}
