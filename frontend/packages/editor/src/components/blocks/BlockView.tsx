import React from "react";
import type {
  SBlock,
  SImgBlock,
  SStyleClass,
  SStyleProps,
  SpacingToken,
  Span,
} from "../../models/sdm";
import { useAssetSrc } from "../../hooks/useAssetSrc";
import { useEditor } from "../../store/editor-store";
import type { EditorAction } from "../../store/editor-store";
import { createBlock } from "../../models/sdm-factory";

export interface BlockViewProps {
  block: SBlock;
  selected: boolean;
  /** Named style classes from doc.styles — passed down to avoid repeated store reads. */
  styles: Record<string, SStyleClass>;
  dispatch: React.Dispatch<EditorAction>;
}



function gapValue(token?: SpacingToken): string {
  const map: Record<SpacingToken, string> = {
    none: "0",
    xs: "0.25rem",
    sm: "0.5rem",
    md: "1rem",
    lg: "1.5rem",
    xl: "2rem",
    "2xl": "3rem",
  };
  return token ? (map[token] ?? "0") : "0";
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
    const spacingMap: Record<string, string> = {
      none: "0", xs: "0.25rem", sm: "0.5rem", md: "1rem",
      lg: "1.5rem", xl: "2rem", "2xl": "3rem",
    };
    if (props.spacing.inner) css.padding = spacingMap[props.spacing.inner] ?? "0";
    if (props.spacing.outer) css.margin  = spacingMap[props.spacing.outer] ?? "0";
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
                    resolved.startsWith("https://");
  const isLoading = !hasImage &&
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



export function BlockView({ block, selected, styles, dispatch }: BlockViewProps): React.ReactElement {
  // Use the store only to resolve selection state for recursively rendered children.
  const { state } = useEditor();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: "SELECT_BLOCK", id: block.id });
  };

  const selClass = selected ? "block-selected" : "";

  const baseStyle: React.CSSProperties =
    block.style && styles[block.style]
      ? resolveStyleProps(styles[block.style]!.props)
      : {};
  const overrideStyle: React.CSSProperties =
    block.styleOverrides ? resolveStyleProps(block.styleOverrides) : {};
  const inlineStyle: React.CSSProperties = { ...baseStyle, ...overrideStyle };

  // Block-level spacing tokens → padding / margin on the selection wrapper.
  const spacingStyle: React.CSSProperties = {};
  if (block.spacing?.inner) {
    const sm: Record<string, string> = {
      none: "0", xs: "0.25rem", sm: "0.5rem", md: "1rem",
      lg: "1.5rem", xl: "2rem", "2xl": "3rem",
    };
    spacingStyle.padding = sm[block.spacing.inner] ?? "0";
  }
  if (block.spacing?.outer) {
    const sm: Record<string, string> = {
      none: "0", xs: "0.25rem", sm: "0.5rem", md: "1rem",
      lg: "1.5rem", xl: "2rem", "2xl": "3rem",
    };
    spacingStyle.margin = sm[block.spacing.outer] ?? "0";
  }

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

  const makeSpanBlur = (id: string) => (e: React.FocusEvent<HTMLElement>) => {
    dispatch({ type: "SET_BLOCK_SPANS", id, spans: [{ text: e.currentTarget.innerText }] });
  };

  /**
   * Keyboard handler for contentEditable text blocks.
   * Enter (without modifier) → insert new paragraph after this block.
   * Backspace on an empty block → delete it.
   */
  const makeKeyDown = (blockId: string) => (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const newBlock = createBlock("p");
      dispatch({ type: "ADD_BLOCK", block: newBlock, afterId: blockId });
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
        dispatch({ type: "DELETE_BLOCK", id: blockId });
        dispatch({ type: "SELECT_BLOCK", id: null });
      }
    }
  };



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
      return wrap(
        <Tag
          style={inlineStyle}
          contentEditable
          suppressContentEditableWarning
          onBlur={makeSpanBlur(block.id)}
          onKeyDown={makeKeyDown(block.id)}
          data-placeholder={headingPlaceholders[block.type]}
          className="sgf-editable focus:outline-none"
        >
          {block.spans.map(renderSpan)}
        </Tag>,
      );
    }

    case "quote":
      return wrap(
        <blockquote
          style={inlineStyle}
          contentEditable
          suppressContentEditableWarning
          onBlur={makeSpanBlur(block.id)}
          onKeyDown={makeKeyDown(block.id)}
          data-placeholder="Quote"
          className="sgf-editable focus:outline-none"
        >
          {block.spans.map(renderSpan)}
        </blockquote>,
      );

    case "figcaption":
      return wrap(
        <figcaption
          style={inlineStyle}
          contentEditable
          suppressContentEditableWarning
          onBlur={makeSpanBlur(block.id)}
          onKeyDown={makeKeyDown(block.id)}
          data-placeholder="Caption"
          className="sgf-editable focus:outline-none"
        >
          {block.spans.map(renderSpan)}
        </figcaption>,
      );

    // li is always a child of ul/ol — skip the outer div to keep valid HTML.
    case "li":
      return (
        <li
          data-block-id={block.id}
          style={inlineStyle}
          className={`${selClass} sgf-editable focus:outline-none`}
          onClick={handleClick}
          contentEditable
          suppressContentEditableWarning
          onBlur={makeSpanBlur(block.id)}
          onKeyDown={makeKeyDown(block.id)}
          data-placeholder="List item"
        >
          {block.spans.map(renderSpan)}
        </li>
      );

    // td/th are table cells — no outer div per spec.
    case "td":
    case "th": {
      const CellTag = block.type as "td" | "th";
      return (
        <CellTag
          data-block-id={block.id}
          style={inlineStyle}
          className={`${selClass} focus:outline-none`}
          onClick={handleClick}
          contentEditable
          suppressContentEditableWarning
          onBlur={makeSpanBlur(block.id)}
          onKeyDown={makeKeyDown(block.id)}
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
            onBlur={(e) =>
              dispatch({ type: "SET_BLOCK_TEXT", id: block.id, text: e.currentTarget.innerText })
            }
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
          className={`pagebreak ${selClass}`}
          style={{ pageBreakAfter: "always", ...inlineStyle }}
        />
      );



    case "hbox":
      return wrap(
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            gap: gapValue(block.gap),
            ...inlineStyle,
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
          }}
        >
          {block.children.map(renderChild)}
        </div>,
      );



    case "table":
      return wrap(
        <table style={inlineStyle}>
          <tbody>
            {block.children.map(renderChild)}
          </tbody>
        </table>,
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
