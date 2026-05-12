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
  TextBlockType,
} from "../../models/sdm";
import { useAssetSrc } from "../../hooks/useAssetSrc";
import { useDataSource, aggregate } from "../../hooks/useDataSource";
import type { AggFunction } from "../../hooks/useDataSource";
import { useEditor } from "../../store/editor-store";
import type { EditorAction } from "../../store/editor-store";
import { createBlock } from "../../models/sdm-factory";
import type { NLPToken, NLPBlockAnnotation } from "../../models/nlp";
import { posColor, NER_COLORS, posLabel } from "../../models/nlp";
import type { NLPVisibilityFlags } from "../../models/editor-context";
import { focusBlockEditable, focusBlockNavigationTarget } from "../../utils/block-focus";
import { InlineActionRail } from "../shared/InlineActionRail";

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



function ComposeBlockRail({
  block,
  dispatch,
}: {
  block: SBlock;
  dispatch: React.Dispatch<EditorAction>;
}) {
  const typeActions: Array<{ id: TextBlockType; label: string }> = [
    { id: "p", label: "P" },
    { id: "h1", label: "H1" },
    { id: "h2", label: "H2" },
    { id: "quote", label: "Quote" },
  ];
  const insertActions: Array<{ type: TextBlockType; label: string }> = [
    { type: "p", label: "+ Paragraph" },
    { type: "h2", label: "+ Heading" },
    { type: "quote", label: "+ Quote" },
  ];

  return (
    <InlineActionRail
      title="Compose"
      subtitle="Quick block actions"
      badges={[block.type.toUpperCase()]}
      metrics={[{ label: "Block", value: block.id.slice(0, 8) }]}
      actions={[
        ...typeActions.map((action) => ({
          id: `type-${action.id}`,
          label: action.label,
          onClick: () => dispatch({ type: "CHANGE_BLOCK_TYPE", id: block.id, newType: action.id }),
          active: block.type === action.id,
        })),
        ...insertActions.map((action) => ({
          id: `insert-${action.type}`,
          label: action.label,
          onClick: () => dispatch({ type: "ADD_BLOCK", block: createBlock(action.type), afterId: block.id }),
        })),
      ]}
      className="pointer-events-auto"
    />
  );
}

function NLPTokenSpan({
  blockId,
  token,
  tokenIndex,
  flags,
  selected,
  dispatch,
}: {
  blockId: string;
  token: NLPToken;
  tokenIndex: number;
  flags: NLPVisibilityFlags;
  selected: boolean;
  dispatch: React.Dispatch<EditorAction>;
}) {
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

  const metrics = [
    ...(token.lemma ? [{ label: "Lemma", value: token.lemma }] : []),
    ...(token.keywordScore != null ? [{ label: "Keyword", value: token.keywordScore.toFixed(2) }] : []),
    ...(token.similarity != null ? [{ label: "Similarity", value: token.similarity.toFixed(3) }] : []),
    ...(token.vectorDistance != null ? [{ label: "Vector dist.", value: token.vectorDistance.toFixed(3) }] : []),
  ];

  return (
    <span className="relative inline-flex items-end">
      <span
        style={{
          background: bg,
          outline: selected ? "1px solid var(--theme-primary)" : outline,
          textDecoration: decoration,
          textDecorationColor: decoration ? "#ef4444" : undefined,
          padding: bg || selected ? "0 2px" : undefined,
          borderRadius: bg || selected ? "2px" : undefined,
          cursor: "pointer",
        }}
        title={title}
        onClick={(e) => {
          e.stopPropagation();
          dispatch({ type: "SELECT_TOKEN", blockId, tokenIndex });
        }}
      >
        {flags.showPOS && token.pos && (
          <span
            style={{
              position: "absolute",
              top: "-0.2rem",
              left: "-0.75rem",
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
              fontSize: "7px",
              lineHeight: 1,
              letterSpacing: "0.08em",
              color: "rgba(15,23,42,0.65)",
              opacity: 0.8,
              pointerEvents: "none",
            }}
          >
            {posLabel(token.pos)}
          </span>
        )}
        {token.text}
      </span>
      {token.whitespaceAfter ?? " "}
      {selected && (
        <div className="absolute left-0 top-full z-20 pt-1">
          <InlineActionRail
            title="Token"
            subtitle={token.text}
            badges={[
              ...(token.pos ? [token.pos] : []),
              ...(token.ner ? [token.ner] : []),
              ...(token.isKeyword ? ["keyword"] : []),
            ]}
            metrics={metrics}
            actions={[
              {
                id: "select-block",
                label: "Block",
                icon: "layout",
                onClick: () => dispatch({ type: "SELECT_BLOCK", id: blockId }),
              },
              {
                id: "clear",
                label: "Close",
                icon: "close",
                onClick: () => dispatch({ type: "CLEAR_SELECTED_TOKEN" }),
              },
            ]}
          >
            {token.synonyms?.length ? (
              <div className="flex flex-wrap gap-1">
                {token.synonyms.slice(0, 6).map((synonym) => (
                  <span
                    key={synonym}
                    className="rounded-full border border-[var(--theme-primary)]/20 bg-[var(--theme-primary)]/10 px-1.5 py-0.5 text-[8px] font-medium text-[var(--theme-primary)]"
                  >
                    {synonym}
                  </span>
                ))}
              </div>
            ) : null}
          </InlineActionRail>
        </div>
      )}
    </span>
  );
}

function renderNLPContent(
  blockId: string,
  nlp: NLPBlockAnnotation,
  flags: NLPVisibilityFlags,
  selectedTokenIndex: number | null,
  dispatch: React.Dispatch<EditorAction>,
): React.ReactNode {
  return (
    <>
      {nlp.tokens.map((token, i) => (
        <NLPTokenSpan
          key={i}
          blockId={blockId}
          token={token}
          tokenIndex={i}
          flags={flags}
          selected={selectedTokenIndex === i}
          dispatch={dispatch}
        />
      ))}
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
  const isLayoutContext = state.context === "layout";
  const isComposeContext = state.context === "compose";
  const supportsInlineEditing = [
    "p", "h1", "h2", "h3", "h4", "quote", "figcaption", "li", "td", "th", "code",
  ].includes(block.type);
  const isInlineEditing = isComposeContext
    || (isLayoutContext && state.editingBlockId === block.id);
  const selectedTokenIndex = state.selectedToken?.blockId === block.id ? state.selectedToken.tokenIndex : null;

  const startEditing = useCallback((moveCaretToEnd = false) => {
    if (!isLayoutContext || !supportsInlineEditing) return;
    dispatch({ type: "START_EDITING_BLOCK", id: block.id, moveCaretToEnd });
  }, [dispatch, block.id, isLayoutContext, supportsInlineEditing]);

  const stopEditing = useCallback((focusNavigation = false) => {
    if (!isLayoutContext) return;
    dispatch({ type: "STOP_EDITING_BLOCK", id: block.id });
    if (focusNavigation) requestAnimationFrame(() => focusBlockNavigationTarget(block.id));
  }, [dispatch, block.id, isLayoutContext]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isComposeContext) {
      dispatch({ type: "SELECT_BLOCK", id: block.id });
      return;
    }
    if (isLayoutContext && supportsInlineEditing) {
      if (!isInlineEditing) startEditing(false);
      return;
    }
    dispatch({ type: "SELECT_BLOCK", id: block.id });
  }, [dispatch, block.id, isComposeContext, isLayoutContext, supportsInlineEditing, isInlineEditing, startEditing]);

  const selClass = (selected && state.context !== "compose") ? "block-selected" : "";

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
  const handleLayoutNavigationKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    if (!isLayoutContext || state.editingBlockId === block.id) return;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      dispatch({ type: "SELECT_NEIGHBOR", direction: "up" });
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      dispatch({ type: "SELECT_NEIGHBOR", direction: "down" });
    } else if (e.key === "Enter") {
      if (!supportsInlineEditing) return;
      e.preventDefault();
      e.stopPropagation();
      startEditing(true);
    } else if ((e.key === "Backspace" || e.key === "Delete") && selected) {
      e.preventDefault();
      dispatch({ type: "DELETE_BLOCK", id: block.id });
    }
  }, [dispatch, block.id, isLayoutContext, selected, startEditing, supportsInlineEditing, state.editingBlockId]);

  const layoutWrapperFocusProps = isLayoutContext
    ? { tabIndex: 0, "data-block-focus-target": "true", onKeyDown: handleLayoutNavigationKeyDown }
    : {};
  const layoutEditableFocusProps = isLayoutContext
    ? { tabIndex: 0, "data-block-focus-target": "true" }
    : {};
  const handleEditableFocus = useCallback(() => {
    dispatch({ type: "SELECT_BLOCK", id: block.id });
  }, [dispatch, block.id]);

  const wrap = (el: React.ReactElement): React.ReactElement => (
    <div
      data-block-id={block.id}
      onClick={handleClick}
      {...layoutWrapperFocusProps}
      className={selClass}
      style={{ ...spacingStyle, position: "relative" }}
    >
      {isComposeContext && selected && (
        <div className="pointer-events-none absolute right-0 top-0 z-10 -translate-y-full pb-2">
          <ComposeBlockRail block={block} dispatch={dispatch} />
        </div>
      )}
      {el}
    </div>
  );

  const handleSpanBlur = useCallback((e: React.FocusEvent<HTMLElement>) => {
    if (!isInlineEditing) return;
    dispatch({ type: "SET_BLOCK_SPANS", id: block.id, spans: [{ text: e.currentTarget.innerText }] });
    if (isLayoutContext) dispatch({ type: "STOP_EDITING_BLOCK", id: block.id });
  }, [dispatch, block.id, isInlineEditing, isLayoutContext]);

  const handleCodeBlur = useCallback((e: React.FocusEvent<HTMLElement>) => {
    if (!isInlineEditing) return;
    dispatch({ type: "SET_BLOCK_TEXT", id: block.id, text: e.currentTarget.innerText });
    if (isLayoutContext) dispatch({ type: "STOP_EDITING_BLOCK", id: block.id });
  }, [dispatch, block.id, isInlineEditing, isLayoutContext]);

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
   * Compose Mode:
   *   - Enter spawns a new block seamlessly and focuses it.
   *   - Backspace on an empty block deletes it.
   *   - Arrow keys move caret normally.
   * Layout Mode:
   *   - Enter or tap enters editing; blur / Escape returns to navigation.
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    if (state.context === "compose") {
      if (e.key === " " && block.type === "p") {
        const sel = window.getSelection();
        const text = e.currentTarget.textContent ?? "";
        if (sel && sel.isCollapsed && sel.focusOffset === text.length) {
          let newType: TextBlockType | null = null;
          if (text === "#") newType = "h1";
          else if (text === "##") newType = "h2";
          else if (text === "###") newType = "h3";
          else if (text === "####") newType = "h4";
          else if (text === ">") newType = "quote";

          if (newType) {
            e.preventDefault();
            dispatch({ type: "CHANGE_BLOCK_TYPE", id: block.id, newType });
            dispatch({ type: "SET_BLOCK_SPANS", id: block.id, spans: [{ text: "" }] });
            // Focus and clear content
            requestAnimationFrame(() => {
              focusBlockEditable(block.id);
              const el = e.currentTarget;
              el.textContent = "";
            });
            return;
          }
        }
      }

      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const newBlock = createBlock("p");
        dispatch({ type: "ADD_BLOCK", block: newBlock, afterId: block.id });

        // Focus the new block seamlessly
        requestAnimationFrame(() => focusBlockEditable(newBlock.id));
      }
      if (e.key === "Backspace") {
        const sel = window.getSelection();
        const text = e.currentTarget.textContent ?? "";

        // Delete block if empty
        if (!text.trim()) {
          e.preventDefault();
          dispatch({ type: "DELETE_BLOCK", id: block.id });
          return;
        }

        // If caret is exactly at position 0, merge with block above
        if (sel && sel.isCollapsed && sel.focusOffset === 0) {
          e.preventDefault();
          dispatch({ type: "MERGE_BLOCK_UP", id: block.id });
        }
      }
    } else if (isLayoutContext) {
      if (!isInlineEditing) {
        handleLayoutNavigationKeyDown(e);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        stopEditing(true);
      }
    }
  }, [
    dispatch,
    block.id,
    state.context,
    isLayoutContext,
    isInlineEditing,
    handleLayoutNavigationKeyDown,
    startEditing,
    stopEditing,
  ]);

  const handleCodeKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    if (!isLayoutContext) return;
    if (!isInlineEditing) {
      handleLayoutNavigationKeyDown(e);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      stopEditing(true);
    }
  }, [handleLayoutNavigationKeyDown, isInlineEditing, isLayoutContext, stopEditing]);

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
        return wrap(<Tag style={inlineStyle}>{renderNLPContent(block.id, block.nlp, nlpFlags, selectedTokenIndex, dispatch)}</Tag>);
      }
      return wrap(
        <Tag
          style={inlineStyle}
          contentEditable={isInlineEditing}
          suppressContentEditableWarning
          onBlur={handleSpanBlur}
          onKeyDown={handleKeyDown}
          onFocus={handleEditableFocus}
          data-block-editable="true"
          data-placeholder={headingPlaceholders[block.type]}
          className="sgf-editable focus:outline-none"
        >
          {block.spans.map(renderSpan)}
        </Tag>,
      );
    }

    case "quote":
      if (showNLPOverlay && block.nlp) {
        return wrap(<blockquote style={inlineStyle}>{renderNLPContent(block.id, block.nlp, nlpFlags, selectedTokenIndex, dispatch)}</blockquote>);
      }
      return wrap(
        <blockquote
          style={inlineStyle}
          contentEditable={isInlineEditing}
          suppressContentEditableWarning
          onBlur={handleSpanBlur}
          onKeyDown={handleKeyDown}
          onFocus={handleEditableFocus}
          data-block-editable="true"
          data-placeholder="Quote"
          className="sgf-editable focus:outline-none"
        >
          {block.spans.map(renderSpan)}
        </blockquote>,
      );

    case "figcaption":
      if (showNLPOverlay && block.nlp) {
        return wrap(<figcaption style={inlineStyle}>{renderNLPContent(block.id, block.nlp, nlpFlags, selectedTokenIndex, dispatch)}</figcaption>);
      }
      return wrap(
        <figcaption
          style={inlineStyle}
          contentEditable={isInlineEditing}
          suppressContentEditableWarning
          onBlur={handleSpanBlur}
          onKeyDown={handleKeyDown}
          onFocus={handleEditableFocus}
          data-block-editable="true"
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
            {renderNLPContent(block.id, block.nlp, nlpFlags, selectedTokenIndex, dispatch)}
          </li>
        );
      }
      return (
        <li
          data-block-id={block.id}
          style={inlineStyle}
          className={`${selClass} sgf-editable focus:outline-none`}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          {...layoutEditableFocusProps}
          contentEditable={isInlineEditing}
          suppressContentEditableWarning
          onBlur={handleSpanBlur}
          onFocus={handleEditableFocus}
          data-block-editable="true"
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
            {renderNLPContent(block.id, block.nlp, nlpFlags, selectedTokenIndex, dispatch)}
          </CellTag>
        );
      }
      return (
        <CellTag
          data-block-id={block.id}
          style={inlineStyle}
          className={`${selClass} focus:outline-none`}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          {...layoutEditableFocusProps}
          contentEditable={isInlineEditing}
          suppressContentEditableWarning
          onBlur={handleSpanBlur}
          onFocus={handleEditableFocus}
          data-block-editable="true"
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
            contentEditable={isInlineEditing}
            suppressContentEditableWarning
            onBlur={handleCodeBlur}
            onKeyDown={handleCodeKeyDown}
            onFocus={handleEditableFocus}
            data-block-editable="true"
          >
            {block.text}
          </code>
        </pre>,
      );



    case "img":
      return (
        <div data-block-id={block.id} onClick={handleClick} className={selClass} {...layoutWrapperFocusProps}>
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
        <div data-block-id={block.id} onClick={handleClick} className={selClass} {...layoutWrapperFocusProps}>
          <hr style={inlineStyle} />
        </div>
      );

    case "pagebreak":
      return (
        <div
          data-block-id={block.id}
          onClick={handleClick}
          {...layoutWrapperFocusProps}
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
        <div data-block-id={unknown.id} onClick={handleClick} className={selClass} {...layoutWrapperFocusProps}>
          <div data-block-type={unknown.type}>
            [{unknown.type}]
          </div>
        </div>
      );
    }
  }
}
