import React, { useCallback } from "react";
import type {
  SBlock,
  SImgBlock,
  SStyleClass,
  SStyleProps,
  STableBlock,
  STableCell,
  STrBlock,
  SpacingToken,
  Span,
} from "../../models/sdm";
import { useAssetSrc } from "../../hooks/useAssetSrc";
import { useDataSource, aggregate } from "../../hooks/useDataSource";
import type { AggFunction } from "../../hooks/useDataSource";
import { useEditor } from "../../store/editor-store";
import type { EditorAction } from "../../store/editor-store";
import { createBlock } from "../../models/sdm-factory";
import type { NLPToken, NLPBlockAnnotation } from "../../models/nlp";
import { posColor, NER_COLORS } from "../../models/nlp";
import type { NLPVisibilityFlags } from "../../models/editor-context";

/** Canonical spacing token → CSS rem value mapping. */
const SPACING_PX: Record<SpacingToken, string> = {
  none: "0",
  xs:   "0.25rem",
  sm:   "0.5rem",
  md:   "1rem",
  lg:   "1.5rem",
  xl:   "2rem",
  "2xl":"3rem",
};

export interface BlockViewProps {
  block: SBlock;
  selected: boolean;
  /** Named style classes from doc.styles — passed down to avoid repeated store reads. */
  styles: Record<string, SStyleClass>;
  dispatch: React.Dispatch<EditorAction>;
}



function gapValue(token?: SpacingToken): string {
  return token ? (SPACING_PX[token] ?? "0") : "0";
}

function resolveStyleProps(props: SStyleProps): React.CSSProperties {
  const css: React.CSSProperties = {};

  if (props.font) {
    const fontMap: Record<string, string> = {
      serif: "Georgia, serif",
      sans:  "Inter, sans-serif",
      mono:  "JetBrains Mono, monospace",
    };
    css.fontFamily = fontMap[props.font];
  }

  if (props.size) {
    const sizeMap: Record<string, string> = {
      xs: "0.75rem", sm: "0.875rem", md: "1rem", lg: "1.125rem",
      xl: "1.25rem", "2xl": "1.5rem", "3xl": "1.875rem", "4xl": "2.25rem",
    };
    css.fontSize = sizeMap[props.size];
  }

  if (props.weight) {
    const weightMap: Record<string, number> = {
      normal: 400, medium: 500, semibold: 600, bold: 700,
    };
    css.fontWeight = weightMap[props.weight];
  }

  if (props.leading) {
    const leadingMap: Record<string, number> = {
      tight: 1.1, snug: 1.25, normal: 1.5, relaxed: 1.625, loose: 2,
    };
    css.lineHeight = leadingMap[props.leading];
  }

  if (props.tracking) {
    const trackingMap: Record<string, string> = {
      tight: "-0.05em", normal: "0em", wide: "0.05em", wider: "0.1em",
    };
    css.letterSpacing = trackingMap[props.tracking];
  }

  if (props.style)      css.fontStyle    = props.style;
  if (props.color)      css.color        = props.color;
  if (props.background) css.background   = props.background;
  if (props.align)      css.textAlign    = props.align as React.CSSProperties["textAlign"];

  if (props.decoration) {
    css.textDecoration = props.decoration === "none" ? "none" : props.decoration;
  }

  if (props.border) {
    const { color, width, side, radius } = props.border;
    const radiusMap: Record<string, string> = {
      none: "0", sm: "0.25rem", md: "0.375rem", lg: "0.5rem", full: "9999px",
    };
    if (radius) css.borderRadius = radiusMap[radius] ?? "0";
    if (width && color) {
      const styleVal = `${width} solid ${color}`;
      switch (side ?? "all") {
        case "all":    css.border = styleVal;          break;
        case "top":    css.borderTop = styleVal;       break;
        case "bottom": css.borderBottom = styleVal;    break;
        case "left":   css.borderLeft = styleVal;      break;
        case "right":  css.borderRight = styleVal;     break;
      }
    }
  }

  if (props.spacing) {
    if (props.spacing.inner) css.padding = SPACING_PX[props.spacing.inner] ?? "0";
    if (props.spacing.outer) css.margin  = SPACING_PX[props.spacing.outer] ?? "0";
  }

  return css;
}



function renderSpan(span: Span, i: number): React.ReactNode {
  // Build up nested mark wrappers from inside out.
  let node: React.ReactNode = span.text;

  if (span.marks) {
    for (const mark of span.marks) {
      switch (mark) {
        case "bold":
          node = <strong>{node}</strong>;
          break;
        case "italic":
          node = <em>{node}</em>;
          break;
        case "underline":
          node = <u>{node}</u>;
          break;
        case "strike":
          node = <s>{node}</s>;
          break;
        case "code":
          node = <code>{node}</code>;
          break;
        case "link":
          node = <a href={span.href ?? "#"}>{node}</a>;
          break;
        case "sup":
          node = <sup>{node}</sup>;
          break;
        case "sub":
          node = <sub>{node}</sub>;
          break;
      }
    }
  }

  return <React.Fragment key={i}>{node}</React.Fragment>;
}



// ── NLP annotation rendering ─────────────────────────────────────────────────
// These helpers are used by BlockView for every text block type so that NLP
// annotations work at any depth (nested list items, table cells, layout blocks).

/** Renders one NLP token with POS/NER/keyword/spell visual styling. */
function NLPTokenSpan({ token, flags }: { token: NLPToken; flags: NLPVisibilityFlags }) {
  let bg: string | undefined;
  let outline: string | undefined;
  let decoration: string | undefined;
  let title: string | undefined;

  if (flags.showPOS && token.pos)        { bg = posColor(token.pos); title = token.pos; }
  if (flags.showNER && token.ner)        { bg = NER_COLORS[token.ner] ?? bg; title = token.ner; }
  if (flags.showKeywords && token.isKeyword) {
    outline = "1px solid currentColor";
    title = title ?? (token.keywordScore != null
      ? `Keyword (${token.keywordScore.toFixed(2)})` : "Keyword");
  }
  if (flags.showSpellErrors && token.spellError) {
    decoration = "underline wavy";
    title = token.suggestion ? `Suggestion: ${token.suggestion}` : "Spelling error";
  }
  if (flags.showSynonyms && token.synonyms?.length) {
    title = `Synonyms: ${token.synonyms.slice(0, 3).join(", ")}`;
  }
  return (
    <span
      style={{
        background:          bg,
        outline,
        textDecoration:      decoration,
        textDecorationColor: decoration ? "#ef4444" : undefined,
        padding:             bg ? "0 2px" : undefined,
        borderRadius:        bg ? "2px" : undefined,
        cursor:              title ? "help" : undefined,
      }}
      title={title}
    >
      {token.text}{token.whitespaceAfter ?? " "}
    </span>
  );
}

/** Returns annotated token spans + optional readability badge. */
function renderNLPContent(nlp: NLPBlockAnnotation, flags: NLPVisibilityFlags): React.ReactNode {
  return (
    <>
      {nlp.tokens.map((token, i) => <NLPTokenSpan key={i} token={token} flags={flags} />)}
      {flags.showReadability && nlp.readability && (
        <span
          style={{
            marginLeft: "0.5rem", fontSize: "9px", opacity: 0.5,
            border: "1px solid currentColor", borderRadius: "3px", padding: "0 3px",
          }}
        >
          G{nlp.readability.fleschKincaidGrade.toFixed(0)}
        </span>
      )}
    </>
  );
}

interface ImgBlockViewProps {
  block:       SImgBlock;
  selClass:    string;
  inlineStyle: React.CSSProperties;
  onSelect:    (e: React.MouseEvent) => void;
}

function ImgBlockView({ block, selClass, inlineStyle, onSelect }: ImgBlockViewProps): React.ReactElement {
  const resolved  = useAssetSrc(block.src);
  const hasImage  = resolved.startsWith("data:") ||
                    resolved.startsWith("http://") ||
                    resolved.startsWith("https://") ||
                    resolved.startsWith("blob:");
  const isLoading = resolved === "" &&
                    (block.src.startsWith("asset://") || block.src.startsWith("local://"));

  return (
    <figure
      data-block-id={block.id}
      onClick={onSelect}
      className={selClass}
      style={{ margin: 0 }}
    >
      {hasImage ? (
        <img
          src={resolved}
          alt={block.alt ?? ""}
          style={{
            maxWidth: "100%",
            height: "auto",
            display: "block",
            objectFit: block.fit ?? "contain",
            ...inlineStyle,
          }}
        />
      ) : (
        <div style={{
          padding: "0.5rem",
          opacity: 0.5,
          border: "1px dashed currentColor",
          borderRadius: "4px",
          fontSize: "0.75rem",
          fontFamily: "monospace",
          minHeight: "3rem",
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
        }}>
          {isLoading
            ? <><span style={{ opacity: 0.4 }}>⏳</span> {block.src}</>
            : <><span style={{ opacity: 0.4 }}>🖼</span> {block.src}</>
          }
        </div>
      )}
      {block.caption && (
        <figcaption style={{ fontSize: "0.8em", opacity: 0.7, marginTop: "0.25rem" }}>
          {block.caption}
        </figcaption>
      )}
    </figure>
  );
}



// ---------------------------------------------------------------------------
// TableBlockView — handles both static and data-source-backed tables
// ---------------------------------------------------------------------------

interface TableBlockViewProps {
  block:       STableBlock;
  inlineStyle: React.CSSProperties;
  selClass:    string;
  onSelect:    (e: React.MouseEvent) => void;
  styles:      Record<string, SStyleClass>;
  dispatch:    (action: EditorAction) => void;
}

/**
 * Renders a table block.
 *
 * When block.data_source is present:
 * - Rows with header: true go into <thead> and are always shown.
 * - Rows with footer: true go into <tfoot>; cells with agg + col_key
 *   show a computed aggregate (sum, count, avg, min, max) — no formula
 *   engine required, just a plain JS array reduction.
 * - All other rows in block.children are replaced by dynamic rows from
 *   the loaded data (CSV columns matched by header key).
 *
 * Without a data_source the original static block.children are rendered
 * as before (fully editable).
 */
function TableBlockView({
  block, inlineStyle, selClass, onSelect, styles, dispatch,
}: TableBlockViewProps): React.ReactElement {
  const { data, loading, error } = useDataSource(block.data_source);

  const headerRows = block.children.filter(r => r.header);
  const footerRows = block.children.filter(r => r.footer);
  const staticRows = block.children.filter(r => !r.header && !r.footer);

  const colCount =
    headerRows[0]?.children.length ??
    footerRows[0]?.children.length ??
    (staticRows[0]?.children.length ?? 1);

  // Derive column keys from header cell text (same lowercase transform as parseCSV)
  const colKeys: string[] =
    headerRows[0]?.children.map((c: STableCell) =>
      (c.spans[0]?.text ?? "").toLowerCase().replace(/\s+/g, "_"),
    ) ?? [];

  const renderStaticRow = (row: STrBlock): React.ReactElement => (
    <BlockView
      key={row.id}
      block={row}
      selected={false}
      styles={styles}
      dispatch={dispatch}
    />
  );

  // Dynamic body rows from data_source
  let bodyContent: React.ReactNode;

  if (block.data_source) {
    if (loading) {
      bodyContent = (
        <tr>
          <td colSpan={colCount} style={{ textAlign: "center", padding: "0.5rem", opacity: 0.5, fontStyle: "italic", fontSize: "0.8em" }}>
            Loading data...
          </td>
        </tr>
      );
    } else if (error) {
      bodyContent = (
        <tr>
          <td colSpan={colCount} style={{ color: "#ef4444", padding: "0.5rem", fontSize: "0.8em" }}>
            {error}
          </td>
        </tr>
      );
    } else if (data && data.rows.length > 0) {
      bodyContent = data.rows.map((row, i) => (
        <tr key={i}>
          {colKeys.length > 0
            ? colKeys.map((key, j) => (
                <td key={j}>{row[key] ?? row[Object.keys(row)[j]!] ?? ""}</td>
              ))
            : Object.values(row).map((v, j) => <td key={j}>{v}</td>)
          }
        </tr>
      ));
    } else {
      bodyContent = (
        <tr>
          <td colSpan={colCount} style={{ textAlign: "center", opacity: 0.4, fontStyle: "italic", fontSize: "0.8em" }}>
            (no data rows)
          </td>
        </tr>
      );
    }
  } else {
    bodyContent = staticRows.map(renderStaticRow);
  }

  // Aggregate footer rows
  const footerContent: React.ReactNode[] = footerRows.map(row => {
    const cells = row.children.map((cell: STableCell, i: number) => {
      let content: React.ReactNode = cell.spans.map(s => s.text).join("");

      if (cell.agg && data) {
        const key = cell.col_key ?? colKeys[i] ?? "";
        const fn  = cell.agg as AggFunction;
        const val = aggregate(data.rows, key, fn);
        const dp  = cell.decimals ?? 2;
        const formatted = val.toLocaleString(undefined, {
          minimumFractionDigits:  dp,
          maximumFractionDigits:  dp,
        });
        content = `${cell.prefix ?? ""}${formatted}`;
      }

      return (
        <td key={i} colSpan={cell.colspan}>
          {content}
        </td>
      );
    });
    return <tr key={row.id}>{cells}</tr>;
  });

  return (
    <div data-block-id={block.id} onClick={onSelect} className={selClass}>
      <table style={inlineStyle}>
        {headerRows.length > 0 && (
          <thead>{headerRows.map(renderStaticRow)}</thead>
        )}
        <tbody>{bodyContent}</tbody>
        {footerContent.length > 0 && (
          <tfoot>{footerContent}</tfoot>
        )}
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function BlockView({ block, selected, styles, dispatch }: BlockViewProps): React.ReactElement {
  // Use the store only to resolve selection state for recursively rendered children.
  const { state } = useEditor();

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: "SELECT_BLOCK", id: block.id });
  }, [dispatch, block.id]);

  const selClass = selected ? "block-selected" : "";

  // NLP overlay — derived from the store so it automatically propagates to
  // all recursively-rendered child blocks without extra prop drilling.
  const showNLPOverlay = state.context === "nlp";
  const nlpFlags       = state.nlpFlags;

  const baseStyle: React.CSSProperties =
    block.style && styles[block.style]
      ? resolveStyleProps(styles[block.style]!.props)
      : {};
  const overrideStyle: React.CSSProperties =
    block.styleOverrides ? resolveStyleProps(block.styleOverrides) : {};
  const inlineStyle: React.CSSProperties = { ...baseStyle, ...overrideStyle };

  // Block-level spacing tokens → padding / margin on the selection wrapper.
  const spacingStyle: React.CSSProperties = {};
  if (block.spacing?.inner) spacingStyle.padding = SPACING_PX[block.spacing.inner] ?? "0";
  if (block.spacing?.outer) spacingStyle.margin  = SPACING_PX[block.spacing.outer] ?? "0";

  /** Renders a child block with selection resolved from the store. */
  const renderChild = (child: SBlock) => (
    <BlockView
      key={child.id}
      block={child}
      selected={state.selectedBlockId === child.id}
      styles={styles}
      dispatch={dispatch}
    />
  );

  /** Wraps element in selection div for top-level / container blocks. */
  const wrap = (el: React.ReactElement): React.ReactElement => (
    <div data-block-id={block.id} onClick={handleClick} className={selClass} style={spacingStyle}>
      {el}
    </div>
  );

  const handleSpanBlur = useCallback((e: React.FocusEvent<HTMLElement>) => {
    dispatch({ type: "SET_BLOCK_SPANS", id: block.id, spans: [{ text: e.currentTarget.innerText }] });
  }, [dispatch, block.id]);

  const handleCodeBlur = useCallback((e: React.FocusEvent<HTMLElement>) => {
    dispatch({ type: "SET_BLOCK_TEXT", id: block.id, text: e.currentTarget.innerText });
  }, [dispatch, block.id]);

  // Alignment helper maps — declared once, reused across layout-block cases.
  const hAlignMap: Record<string, string> = {
    start: "flex-start", center: "center", end: "flex-end", fill: "stretch",
  };
  const vAlignMap: Record<string, string> = {
    top: "flex-start", middle: "center", bottom: "flex-end", fill: "stretch",
  };
  const hAlignMapText: Record<string, React.CSSProperties["textAlign"]> = {
    start: "left", center: "center", end: "right", fill: "justify",
  };

  /**
   * Keyboard handler for contentEditable text blocks.
   * Enter (without modifier) → insert new paragraph after this block.
   * Backspace on an empty block → delete it.
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const newBlock = createBlock("p");
      dispatch({ type: "ADD_BLOCK", block: newBlock, afterId: block.id });
      dispatch({ type: "SELECT_BLOCK", id: newBlock.id });
      // Focus the new block's contentEditable after React re-renders.
      requestAnimationFrame(() => {
        const el = document.querySelector(
          `[data-block-id="${newBlock.id}"] [contenteditable]`,
        ) as HTMLElement | null;
        el?.focus();
      });
    }
    if (e.key === "Backspace") {
      const text = e.currentTarget.textContent ?? "";
      if (!text.trim()) {
        e.preventDefault();
        dispatch({ type: "DELETE_BLOCK", id: block.id });
        dispatch({ type: "SELECT_BLOCK", id: null });
      }
    }
  }, [dispatch, block.id]);

  // Apply block-level text-alignment (overrides SStyleProps.align from the style class).
  if (block.align?.h) {
    const ta = hAlignMapText[block.align.h];
    const TEXT_TYPES = new Set(["p", "h1", "h2", "h3", "h4", "quote", "figcaption", "li", "td", "th"]);
    if (ta && TEXT_TYPES.has(block.type)) {
      (inlineStyle as React.CSSProperties).textAlign = ta;
    }
  }

  switch (block.type) {
    case "p":
    case "h1":
    case "h2":
    case "h3":
    case "h4": {
      const Tag = block.type as "p" | "h1" | "h2" | "h3" | "h4";
      const headingPlaceholders: Record<string, string> = {
        p: "Paragraph", h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", h4: "Heading 4",
      };
      if (showNLPOverlay && block.nlp) {
        return wrap(<Tag style={inlineStyle}>{renderNLPContent(block.nlp, nlpFlags)}</Tag>);
      }
      return wrap(
        <Tag
          style={inlineStyle}
          contentEditable
          suppressContentEditableWarning
          onBlur={handleSpanBlur}
          onKeyDown={handleKeyDown}
          data-placeholder={headingPlaceholders[block.type]}
          className="sgf-editable focus:outline-none"
        >
          {block.spans.map(renderSpan)}
        </Tag>,
      );
    }

    case "quote":
      if (showNLPOverlay && block.nlp) {
        return wrap(<blockquote style={inlineStyle}>{renderNLPContent(block.nlp, nlpFlags)}</blockquote>);
      }
      return wrap(
        <blockquote
          style={inlineStyle}
          contentEditable
          suppressContentEditableWarning
          onBlur={handleSpanBlur}
          onKeyDown={handleKeyDown}
          data-placeholder="Quote"
          className="sgf-editable focus:outline-none"
        >
          {block.spans.map(renderSpan)}
        </blockquote>,
      );

    case "figcaption":
      if (showNLPOverlay && block.nlp) {
        return wrap(<figcaption style={inlineStyle}>{renderNLPContent(block.nlp, nlpFlags)}</figcaption>);
      }
      return wrap(
        <figcaption
          style={inlineStyle}
          contentEditable
          suppressContentEditableWarning
          onBlur={handleSpanBlur}
          onKeyDown={handleKeyDown}
          data-placeholder="Caption"
          className="sgf-editable focus:outline-none"
        >
          {block.spans.map(renderSpan)}
        </figcaption>,
      );

    // li is always a child of ul/ol — skip the outer div to keep valid HTML.
    case "li":
      if (showNLPOverlay && block.nlp) {
        return (
          <li data-block-id={block.id} style={inlineStyle} className={selClass} onClick={handleClick}>
            {renderNLPContent(block.nlp, nlpFlags)}
          </li>
        );
      }
      return (
        <li
          data-block-id={block.id}
          style={inlineStyle}
          className={`${selClass} sgf-editable focus:outline-none`}
          onClick={handleClick}
          contentEditable
          suppressContentEditableWarning
          onBlur={handleSpanBlur}
          onKeyDown={handleKeyDown}
          data-placeholder="List item"
        >
          {block.spans.map(renderSpan)}
        </li>
      );

    // td/th are table cells — no outer div per spec.
    case "td":
    case "th": {
      const CellTag = block.type as "td" | "th";
      if (showNLPOverlay && block.nlp) {
        return (
          <CellTag data-block-id={block.id} style={inlineStyle} className={selClass} onClick={handleClick}>
            {renderNLPContent(block.nlp, nlpFlags)}
          </CellTag>
        );
      }
      return (
        <CellTag
          data-block-id={block.id}
          style={inlineStyle}
          className={`${selClass} focus:outline-none`}
          onClick={handleClick}
          contentEditable
          suppressContentEditableWarning
          onBlur={handleSpanBlur}
          onKeyDown={handleKeyDown}
        >
          {block.spans.map(renderSpan)}
        </CellTag>
      );
    }



    case "ul":
      return wrap(
        <ul style={inlineStyle}>
          {block.children.map(renderChild)}
        </ul>,
      );

    case "ol":
      return wrap(
        <ol style={inlineStyle}>
          {block.children.map(renderChild)}
        </ol>,
      );



    case "code":
      return wrap(
        <pre style={inlineStyle}>
          <code
            className={`language-${block.language ?? "text"}`}
            contentEditable
            suppressContentEditableWarning
            onBlur={handleCodeBlur}
          >
            {block.text}
          </code>
        </pre>,
      );



    case "img":
      return (
        <div data-block-id={block.id} onClick={handleClick} className={selClass}>
          <ImgBlockView
            block={block as SImgBlock}
            selClass=""
            inlineStyle={inlineStyle}
            onSelect={handleClick}
          />
        </div>
      );



    case "hr":
      return (
        <div data-block-id={block.id} onClick={handleClick} className={selClass}>
          <hr style={inlineStyle} />
        </div>
      );

    case "pagebreak":
      return (
        <div
          data-block-id={block.id}
          onClick={handleClick}
          className={`sgf-page-ruler sgf-pagebreak-block ${selClass}`}
          style={{ ...inlineStyle }}
        >
          {/* Screen: a dashed explicit-break indicator */}
          <div
            style={{
              display:        "flex",
              alignItems:     "center",
              gap:            "8px",
              margin:         "4px 0",
              color:          "rgba(99,102,241,0.6)",
              fontSize:       "9px",
              fontFamily:     "ui-monospace, monospace",
              userSelect:     "none",
              pointerEvents:  "none",
            }}
          >
            <div style={{ flex: 1, borderTop: "1.5px dashed rgba(99,102,241,0.4)" }} />
            <span>Page Break</span>
            <div style={{ flex: 1, borderTop: "1.5px dashed rgba(99,102,241,0.4)" }} />
          </div>
        </div>
      );



    case "hbox":
      return wrap(
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            gap: gapValue(block.gap),
            ...inlineStyle,
            ...(block.align?.h ? { justifyContent: hAlignMap[block.align.h] } : {}),
            ...(block.align?.v ? { alignItems: vAlignMap[block.align.v] } : {}),
          }}
        >
          {block.children.map(renderChild)}
        </div>,
      );

    case "vbox":
      return wrap(
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: gapValue(block.gap),
            ...inlineStyle,
            ...(block.align?.h ? { alignItems: hAlignMap[block.align.h] } : {}),
            ...(block.align?.v ? { justifyContent: vAlignMap[block.align.v] } : {}),
          }}
        >
          {block.children.map(renderChild)}
        </div>,
      );

    case "col":
      return wrap(
        <div
          style={{
            flex: block.width ?? "1",
            gridColumn: block.span ? `span ${block.span}` : undefined,
            ...inlineStyle,
            ...(block.align?.v ? { alignSelf: vAlignMap[block.align.v] } : {}),
            ...(block.align?.h ? { textAlign: (hAlignMapText[block.align.h] ?? undefined) } : {}),
          }}
        >
          {block.children.map(renderChild)}
        </div>,
      );

    case "grid":
      return wrap(
        <div
          style={{
            display: "grid",
            gridTemplateColumns: block.columns.join(" "),
            gap: gapValue(block.gap),
            ...inlineStyle,
            ...(block.align?.h ? { justifyItems: hAlignMap[block.align.h] } : {}),
            ...(block.align?.v ? { alignItems: vAlignMap[block.align.v] } : {}),
          }}
        >
          {block.children.map(renderChild)}
        </div>,
      );



    case "table":
      return (
        <TableBlockView
          block={block as STableBlock}
          inlineStyle={inlineStyle}
          selClass={selClass}
          onSelect={handleClick}
          styles={styles}
          dispatch={dispatch}
        />
      );

    // tr is a table row — no outer div.
    case "tr":
      return (
        <tr data-block-id={block.id} onClick={handleClick} className={selClass}>
          {block.children.map(renderChild)}
        </tr>
      );



    case "callout":
      return wrap(
        <div className={`callout callout-${block.variant}`} style={inlineStyle}>
          {block.icon && <span className="callout-icon">{block.icon}</span>}
          {block.title && <strong className="callout-title" style={{ display: "block", marginBottom: "0.25rem" }}>{block.title}</strong>}
          {block.children.map(renderChild)}
        </div>,
      );



    default: {
      // All known SBlock variants are handled above. This branch only fires
      // for unknown future types — keep it for forward-compatibility.
      const unknown = block as unknown as { id: string; type: string };
      return (
        <div data-block-id={unknown.id} onClick={handleClick} className={selClass}>
          <div data-block-type={unknown.type}>
            [{unknown.type}]
          </div>
        </div>
      );
    }
  }
}
