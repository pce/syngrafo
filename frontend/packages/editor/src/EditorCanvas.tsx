import React, { useRef } from "react";
import { useEditor, useEditorDoc } from "./store/editor-store";
import { useSignal } from "./hooks/useSignal";
import type { Block } from "./models/block";
import type { NLPVisibilityFlags } from "./models/editor-context";
import { posColor, NER_COLORS } from "./models/nlp";
import { Icon } from "./components/Icon";

interface EditorCanvasProps {
  className?: string;
  readOnly?: boolean;
}

function NLPTokenSpan({
  token,
  flags,
}: {
  token: { text: string; pos?: string; ner?: string; isKeyword?: boolean; spellError?: boolean; suggestion?: string; synonyms?: string[] };
  flags: NLPVisibilityFlags;
}) {
  let bg: string | undefined;
  let outline: string | undefined;
  let decoration: string | undefined;
  let title: string | undefined;

  if (flags.showPOS && token.pos) {
    bg = posColor(token.pos);
  }
  if (flags.showNER && token.ner) {
    bg = NER_COLORS[token.ner] ?? bg;
    title = token.ner;
  }
  if (flags.showKeywords && token.isKeyword) {
    outline = "1px solid currentColor";
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
      {token.text}{" "}
    </span>
  );
}

function BlockView({ block, isSelected, readOnly, nlpFlags }: { block: Block; isSelected: boolean; readOnly: boolean; nlpFlags: NLPVisibilityFlags }) {
  const { dispatch } = useEditor();
  const type = block.getType();
  const content = useSignal(block.getContentSignal());
  const meta = block.getMetadata();
  const annotation = block.getNLPAnnotation();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: "SELECT_BLOCK", blockId: block.getId() });
  };

  const handleInput = (e: React.FormEvent<HTMLElement>) => {
    if (readOnly) return;
    block.setContent((e.currentTarget as HTMLElement).innerText);
    dispatch({ type: "SET_DIRTY", isDirty: true });
  };

  const selectedClass = isSelected ? "ring-2 ring-[var(--theme-primary)] ring-offset-1" : "hover:ring-1 hover:ring-[var(--theme-primary)]/30";

  const base = `relative rounded-sm transition-[box-shadow] ${selectedClass} cursor-pointer`;
  const ce = { contentEditable: readOnly ? ("false" as const) : ("true" as const), suppressContentEditableWarning: true };

  const showNLP = annotation && (nlpFlags.showPOS || nlpFlags.showNER || nlpFlags.showKeywords || nlpFlags.showSpellErrors || nlpFlags.showSynonyms);

  const tokenContent = showNLP ? (
    <>
      {annotation.tokens.map((t, i) => (
        <NLPTokenSpan key={i} token={t} flags={nlpFlags} />
      ))}
      {nlpFlags.showReadability && annotation.readability && (
        <span className="ml-2 text-[9px] opacity-50 border rounded px-1 py-0.5">G{annotation.readability.fleschKincaidGrade.toFixed(0)}</span>
      )}
    </>
  ) : null;

  switch (type) {
    case "h1":
      return (
        <h1 data-block-id={block.getId()} className={`${base} ${block.getStyleId()}`} onClick={handleClick} onInput={handleInput} {...ce}>
          {tokenContent ?? content}
        </h1>
      );
    case "h2":
      return (
        <h2 data-block-id={block.getId()} className={`${base} ${block.getStyleId()}`} onClick={handleClick} onInput={handleInput} {...ce}>
          {tokenContent ?? content}
        </h2>
      );
    case "h3":
      return (
        <h3 data-block-id={block.getId()} className={`${base} ${block.getStyleId()}`} onClick={handleClick} onInput={handleInput} {...ce}>
          {tokenContent ?? content}
        </h3>
      );
    case "p":
    case "nlp-block":
      return (
        <p data-block-id={block.getId()} className={`${base} ${block.getStyleId()}`} onClick={handleClick} onInput={handleInput} {...ce}>
          {tokenContent ?? content}
        </p>
      );
    case "ul":
      return (
        <ul data-block-id={block.getId()} className={`${base} ${block.getStyleId()} list-disc pl-5`} onClick={handleClick}>
          {content
            .split("\n")
            .filter(Boolean)
            .map((line, i) => (
              <li key={i}>{line}</li>
            ))}
        </ul>
      );
    case "code":
      return (
        <pre
          data-block-id={block.getId()}
          className={`${base} ${block.getStyleId()} font-mono text-sm bg-black/5 rounded p-2`}
          onClick={handleClick}
          onInput={handleInput}
          {...ce}
        >
          <code>{content}</code>
        </pre>
      );
    case "hr":
      return <hr data-block-id={block.getId()} className={`${selectedClass} ${block.getStyleId()} border-[var(--theme-border)] my-4`} onClick={handleClick} />;
    case "pagebreak":
      return (
        <div
          data-block-id={block.getId()}
          className={`${selectedClass} flex items-center gap-2 my-4 text-[10px] text-[var(--theme-text-muted)] opacity-50`}
          onClick={handleClick}
        >
          <div className="flex-1 border-t border-dashed border-current" />
          <span className="flex items-center gap-1">
            <Icon name="scissors" size="xs" />
            page break
          </span>
          <div className="flex-1 border-t border-dashed border-current" />
        </div>
      );
    case "callout": {
      const variant = String(meta.variant ?? "info");
      const variantColors: Record<string, string> = {
        info: "bg-blue-50 border-l-4 border-blue-400 text-blue-900",
        tip: "bg-emerald-50 border-l-4 border-emerald-400 text-emerald-900",
        warning: "bg-amber-50 border-l-4 border-amber-400 text-amber-900",
        danger: "bg-rose-50 border-l-4 border-rose-400 text-rose-900",
        success: "bg-green-50 border-l-4 border-green-400 text-green-900",
        note: "bg-slate-50 border-l-4 border-slate-400 text-slate-800",
      };
      return (
        <div data-block-id={block.getId()} className={`${base} ${variantColors[variant] ?? variantColors.info} rounded p-3 text-sm`} onClick={handleClick}>
          {meta.title && <strong className="block mb-1">{String(meta.title)}</strong>}
          <div onInput={handleInput} {...ce}>
            {tokenContent ?? content}
          </div>
        </div>
      );
    }
    case "img":
      return (
        <div data-block-id={block.getId()} className={`${base} ${block.getStyleId()}`} onClick={handleClick}>
          {meta.src ? (
            <img src={String(meta.src)} alt={content || "image"} className="max-w-full h-auto rounded" />
          ) : (
            <div className="flex items-center justify-center gap-1.5 h-24 bg-[var(--theme-bg)] border border-dashed border-[var(--theme-border)] rounded text-[var(--theme-text-muted)] text-xs">
              <Icon name="image" size="xs" />
              {content || "Image (no src)"}
            </div>
          )}
        </div>
      );
    case "columns":
    case "hbox": {
      const ratios = (meta.ratios as number[] | undefined) ?? [0.5, 0.5];
      return (
        <div data-block-id={block.getId()} className={`${base} flex gap-2`} onClick={handleClick}>
          {ratios.map((r, i) => (
            <div
              key={i}
              style={{ flex: r }}
              className="border border-dashed border-[var(--theme-border)] rounded p-1 min-h-12 text-[9px] text-[var(--theme-text-muted)] opacity-60 flex items-center justify-center"
            >
              col {i + 1} ({Math.round(r * 100)}%)
            </div>
          ))}
        </div>
      );
    }
    case "stream":
      return (
        <div data-block-id={block.getId()} className={`${base} ${block.getStyleId()} relative`} onClick={handleClick}>
          <p onInput={handleInput} {...ce}>
            {content || "(stream idle)"}
          </p>
          <span className="absolute top-1 right-1 text-[8px] opacity-40">
            <Icon name="refresh" size="xs" />
          </span>
        </div>
      );
    default:
      return (
        <div data-block-id={block.getId()} className={`${base} ${block.getStyleId()} text-sm`} onClick={handleClick} onInput={handleInput} {...ce}>
          {(tokenContent ?? content) || <span className="opacity-30 italic">({type})</span>}
        </div>
      );
  }
}

export function EditorCanvas({ className = "", readOnly = false }: EditorCanvasProps) {
  const { state } = useEditor();
  const doc = useEditorDoc();
  const blocks = useSignal(doc.blocks);
  const pageMarginMm = useSignal(doc.pageMarginMm);
  const containerRef = useRef<HTMLDivElement>(null);

  const { dispatch } = useEditor();
  const handleContainerClick = () => {
    dispatch({ type: "SELECT_BLOCK", blockId: null });
  };

  const childIds = new Set<string>();
  blocks.forEach((b) => {
    if (b.isLayoutContainer()) b.getChildIds().forEach((id) => childIds.add(id));
  });

  const rootBlocks = blocks.filter((b) => !childIds.has(b.getId()));

  return (
    <div ref={containerRef} className={`flex-1 min-h-0 overflow-y-auto bg-[var(--theme-bg)] ${className}`} onClick={handleContainerClick}>
      <div
        className="mx-auto my-8 bg-white text-black shadow-lg rounded-sm preview-root"
        style={{
          width: "210mm",
          minHeight: "297mm",
          padding: `${pageMarginMm}mm`,
          boxSizing: "border-box",
          fontSize: "14px",
          lineHeight: "1.6",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {rootBlocks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-300 gap-2">
            <Icon name="layout" size="xl" />
            <span className="text-sm font-medium">Empty document — add a block to begin</span>
          </div>
        ) : (
          rootBlocks.map((block) => (
            <BlockView key={block.getId()} block={block} isSelected={state.selectedBlockId === block.getId()} readOnly={readOnly} nlpFlags={state.nlpFlags} />
          ))
        )}
      </div>
    </div>
  );
}
