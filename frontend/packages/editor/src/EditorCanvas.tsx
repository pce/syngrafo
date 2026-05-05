import React, { useRef } from "react";
import { useEditor, useEditorDoc } from "./store/editor-store";
import type { EditorAction } from "./store/editor-store";
import { isTextBlock, PAGE_SIZE_MM } from "./models/sdm";
import type { STextBlock, SpacingToken } from "./models/sdm";
import type { NLPVisibilityFlags } from "./models/editor-context";
import { posColor, NER_COLORS } from "./models/nlp";
import type { NLPToken } from "./models/nlp";
import { BlockView } from "./components/blocks/BlockView";
import { Icon } from "./components/Icon";



const MARGIN_MM: Record<SpacingToken, number> = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  "2xl": 48,
};



function NLPTokenSpan({
  token,
  flags,
}: {
  token: NLPToken;
  flags: NLPVisibilityFlags;
}) {
  let bg: string | undefined;
  let outline: string | undefined;
  let decoration: string | undefined;
  let title: string | undefined;

  if (flags.showPOS && token.pos) {
    bg = posColor(token.pos);
    title = token.pos;
  }
  if (flags.showNER && token.ner) {
    bg = NER_COLORS[token.ner] ?? bg;
    title = token.ner;
  }
  if (flags.showKeywords && token.isKeyword) {
    outline = "1px solid currentColor";
    title = title ?? (token.keywordScore != null ? `Keyword (score: ${token.keywordScore.toFixed(2)})` : "Keyword");
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
        background: bg,
        outline,
        textDecoration: decoration,
        textDecorationColor: decoration ? "#ef4444" : undefined,
        padding: bg ? "0 2px" : undefined,
        borderRadius: bg ? "2px" : undefined,
        cursor: title ? "help" : undefined,
      }}
      title={title}
    >
      {token.text}{token.whitespaceAfter ?? " "}
    </span>
  );
}

/** Replaces {@link BlockView} for text blocks when context is "nlp" and `block.nlp` is populated. */
function NLPTextBlockView({
  block,
  selected,
  flags,
  dispatch,
}: {
  block: STextBlock;
  selected: boolean;
  flags: NLPVisibilityFlags;
  dispatch: React.Dispatch<EditorAction>;
}): React.ReactElement {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: "SELECT_BLOCK", id: block.id });
  };

  const selClass = selected ? "block-selected" : "";
  const nlp = block.nlp!;

  type HtmlTag = "h1" | "h2" | "h3" | "h4" | "blockquote" | "p";
  const tagMap: Record<string, HtmlTag> = {
    h1: "h1", h2: "h2", h3: "h3", h4: "h4",
    quote: "blockquote",
  };
  const Tag: HtmlTag = tagMap[block.type] ?? "p";

  return (
    <div data-block-id={block.id} onClick={handleClick} className={selClass}>
      <Tag>
        {nlp.tokens.map((token, i) => (
          <NLPTokenSpan key={i} token={token} flags={flags} />
        ))}
        {flags.showReadability && nlp.readability && (
          <span
            className="nlp-readability-badge"
            style={{
              marginLeft: "0.5rem",
              fontSize: "9px",
              opacity: 0.5,
              border: "1px solid currentColor",
              borderRadius: "3px",
              padding: "0 3px",
            }}
          >
            G{nlp.readability.fleschKincaidGrade.toFixed(0)}
          </span>
        )}
      </Tag>
    </div>
  );
}



export function EditorCanvas(): React.ReactElement {
  const { state, dispatch } = useEditor();
  const doc = useEditorDoc();
  const containerRef = useRef<HTMLDivElement>(null);

  const { selectedBlockId, context, nlpFlags } = state;
  const { page, blocks, styles } = doc;

  // Resolve page dimensions (swap for landscape).
  const baseSize = PAGE_SIZE_MM[page.size];
  const { w, h } =
    page.orientation === "landscape"
      ? { w: baseSize.h, h: baseSize.w }
      : baseSize;
  const marginMm = MARGIN_MM[page.margin] ?? 16;

  const handleContainerClick = () => {
    dispatch({ type: "SELECT_BLOCK", id: null });
  };

  const showNLPOverlay = context === "nlp";

  return (
    <div
      ref={containerRef}
      className="editor-canvas-outer flex-1 min-h-0 overflow-y-auto bg-[var(--theme-bg)]"
      onClick={handleContainerClick}
    >
      <div
        className="editor-canvas-page mx-auto my-8 bg-white text-black shadow-lg rounded-sm"
        style={{
          width: `${w}mm`,
          minHeight: `${h}mm`,
          padding: `${marginMm}mm`,
          boxSizing: "border-box",
          fontSize: "14px",
          lineHeight: "1.6",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {blocks.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center h-48 gap-2"
            style={{ color: "#ccc" }}
          >
            <Icon name="layout" size="xl" />
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>
              Start typing or add a block
            </span>
          </div>
        ) : (
          blocks.map((b) => {
            const isSelected = b.id === selectedBlockId;

            // In NLP context, render token-annotated view for text blocks that
            // have been analysed — fall back to BlockView for everything else.
            if (showNLPOverlay && isTextBlock(b) && b.nlp) {
              return (
                <NLPTextBlockView
                  key={b.id}
                  block={b}
                  selected={isSelected}
                  flags={nlpFlags}
                  dispatch={dispatch}
                />
              );
            }

            return (
              <BlockView
                key={b.id}
                block={b}
                selected={isSelected}
                styles={styles}
                dispatch={dispatch}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
