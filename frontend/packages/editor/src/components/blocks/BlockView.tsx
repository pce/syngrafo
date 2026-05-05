import React from "react";
import type {
  SBlock,
  SStyleClass,
  SStyleProps,
  SpacingToken,
  Span,
} from "../../models/sdm";
import { useEditor } from "../../store/editor-store";
import type { EditorAction } from "../../store/editor-store";

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
      sans: "Inter, sans-serif",
      mono: "JetBrains Mono, monospace",
    };
    css.fontFamily = fontMap[props.font];
  }

  if (props.size) {
    const sizeMap: Record<string, string> = {
      xs: "0.75rem",
      sm: "0.875rem",
      md: "1rem",
      lg: "1.125rem",
      xl: "1.25rem",
      "2xl": "1.5rem",
      "3xl": "1.875rem",
      "4xl": "2.25rem",
    };
    css.fontSize = sizeMap[props.size];
  }

  if (props.weight) {
    const weightMap: Record<string, number> = {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    };
    css.fontWeight = weightMap[props.weight];
  }

  if (props.leading) {
    const leadingMap: Record<string, number> = {
      tight: 1.1,
      snug: 1.25,
      normal: 1.5,
      relaxed: 1.625,
      loose: 2,
    };
    css.lineHeight = leadingMap[props.leading];
  }

  if (props.style) css.fontStyle = props.style;
  if (props.color) css.color = props.color;
  if (props.background) css.background = props.background;
  if (props.align) css.textAlign = props.align as React.CSSProperties["textAlign"];

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



export function BlockView({ block, selected, styles, dispatch }: BlockViewProps): React.ReactElement {
  // Use the store only to resolve selection state for recursively rendered children.
  const { state } = useEditor();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: "SELECT_BLOCK", id: block.id });
  };

  const selClass = selected ? "block-selected" : "";

  const inlineStyle: React.CSSProperties =
    block.style && styles[block.style]
      ? resolveStyleProps(styles[block.style]!.props)
      : {};

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
    <div data-block-id={block.id} onClick={handleClick} className={selClass}>
      {el}
    </div>
  );

  const makeSpanBlur = (id: string) => (e: React.FocusEvent<HTMLElement>) => {
    dispatch({ type: "SET_BLOCK_SPANS", id, spans: [{ text: e.currentTarget.innerText }] });
  };



  switch (block.type) {
    case "p":
    case "h1":
    case "h2":
    case "h3":
    case "h4": {
      const Tag = block.type as "p" | "h1" | "h2" | "h3" | "h4";
      return wrap(
        <Tag
          style={inlineStyle}
          contentEditable
          suppressContentEditableWarning
          onBlur={makeSpanBlur(block.id)}
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
        >
          {block.spans.map(renderSpan)}
        </blockquote>,
      );

    // li is always a child of ul/ol — skip the outer div to keep valid HTML.
    case "li":
      return (
        <li
          data-block-id={block.id}
          style={inlineStyle}
          className={selClass}
          onClick={handleClick}
          contentEditable
          suppressContentEditableWarning
          onBlur={makeSpanBlur(block.id)}
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
          className={selClass}
          onClick={handleClick}
          contentEditable
          suppressContentEditableWarning
          onBlur={makeSpanBlur(block.id)}
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



    case "img": {
      const isLocal =
        block.src.startsWith("local://") || block.src.startsWith("asset://");
      return wrap(
        <figure style={inlineStyle}>
          {isLocal ? (
            <div className="img-placeholder" style={{ padding: "0.5rem", opacity: 0.6, border: "1px dashed currentColor", borderRadius: "4px", fontSize: "0.75rem" }}>
              {block.src}
            </div>
          ) : (
            <img src={block.src} alt={block.alt ?? ""} style={{ maxWidth: "100%", height: "auto" }} />
          )}
          {block.caption && (
            <figcaption style={{ fontSize: "0.8em", opacity: 0.7, marginTop: "0.25rem" }}>
              {block.caption}
            </figcaption>
          )}
        </figure>,
      );
    }



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



    default:
      return (
        <div data-block-id={block.id} onClick={handleClick} className={selClass}>
          <div data-block-type={(block as SBlock).type}>
            [{(block as SBlock).type}]
          </div>
        </div>
      );
  }
}
