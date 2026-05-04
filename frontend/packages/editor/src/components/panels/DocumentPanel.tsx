import React from "react";
import { useEditor, useEditorDoc } from "../../store/editor-store";
import { useSignal, useSignalState } from "../../hooks/useSignal";
import type { PageSize, PageScaleMode } from "../../models/document";
import type { DocumentIntent } from "../../models/editor-context";
import { DOCUMENT_INTENT_META } from "../../models/editor-context";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[8px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60">{label}</label>
      {children}
    </div>
  );
}

const INPUT_CLASS =
  "w-full rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] text-[11px] px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]";

const SELECT_CLASS =
  "w-full rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] text-[11px] px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]";

export function DocumentPanel() {
  const { state, dispatch } = useEditor();
  const doc = useEditorDoc();

  const [title, setTitle] = useSignalState(doc.title);
  const [filename, setFilename] = useSignalState(doc.filename);
  const pageSize = useSignal(doc.pageSize);
  const pageMarginMm = useSignal(doc.pageMarginMm);
  const pageScaleMode = useSignal(doc.pageScaleMode);
  const blocks = useSignal(doc.blocks);

  const wordCount = blocks.reduce((n, b) => {
    const c = b.getContent().trim();
    return n + (c ? c.split(/\s+/).filter(Boolean).length : 0);
  }, 0);
  const charCount = blocks.reduce((n, b) => n + b.getContent().length, 0);

  const markDirty = () => dispatch({ type: "SET_DIRTY", isDirty: true });

  const intentMeta = DOCUMENT_INTENT_META[state.intent];

  return (
    <div className="flex flex-col h-full overflow-y-auto text-[var(--theme-text)]">
      <div className="px-2 py-1.5 border-b border-[var(--theme-border)] shrink-0 bg-[var(--theme-bg)]/40">
        <span className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-70">Document</span>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-[var(--theme-border)]">
        <div className="px-2 py-2 space-y-2">
          <Row label="Title">
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                doc.setTitle(e.target.value);
                markDirty();
              }}
              className={INPUT_CLASS}
              placeholder="Document title…"
            />
          </Row>

          <Row label="Filename">
            <input
              type="text"
              value={filename}
              onChange={(e) => {
                setFilename(e.target.value);
                doc.setFilename(e.target.value);
                markDirty();
              }}
              className={INPUT_CLASS}
              placeholder="document.pdf"
            />
          </Row>
        </div>

        <div className="px-2 py-2 space-y-2">
          <Row label="Document Type">
            <select
              value={state.intent}
              onChange={(e) => {
                dispatch({ type: "SET_INTENT", intent: e.target.value as DocumentIntent });
                markDirty();
              }}
              className={SELECT_CLASS}
            >
              {(Object.values(DOCUMENT_INTENT_META) as (typeof intentMeta)[]).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Row>
          {intentMeta && <p className="text-[8px] text-[var(--theme-text-muted)] opacity-50 leading-snug">{intentMeta.description}</p>}
        </div>

        <div className="px-2 py-2 space-y-2">
          <Row label="Page Size">
            <select
              value={pageSize}
              onChange={(e) => {
                doc.setPageSize(e.target.value as PageSize);
                markDirty();
              }}
              className={SELECT_CLASS}
            >
              {(["a4", "a5", "letter", "legal", "a3", "a6"] as PageSize[]).map((s) => (
                <option key={s} value={s}>
                  {s.toUpperCase()}
                </option>
              ))}
            </select>
          </Row>

          <Row label={`Page Margin — ${pageMarginMm} mm`}>
            <input
              type="range"
              min={0}
              max={50}
              step={1}
              value={pageMarginMm}
              onChange={(e) => {
                doc.setPageMarginMm(Number(e.target.value));
                markDirty();
              }}
              className="w-full h-1.5 accent-[var(--theme-primary)]"
            />
            <div className="flex justify-between text-[8px] text-[var(--theme-text-muted)] opacity-40 -mt-0.5">
              <span>0 mm</span>
              <span>50 mm</span>
            </div>
          </Row>

          <Row label="Scale Mode">
            <div className="flex rounded border border-[var(--theme-border)] overflow-hidden text-[9px]">
              {(["none", "auto", "fit"] as PageScaleMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    doc.setPageScaleMode(m);
                    markDirty();
                  }}
                  className={[
                    "flex-1 py-1 capitalize transition-colors",
                    pageScaleMode === m
                      ? "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] font-bold"
                      : "hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)]",
                  ].join(" ")}
                >
                  {m}
                </button>
              ))}
            </div>
          </Row>
        </div>

        <div className="px-2 py-2">
          <div className="text-[8px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 mb-1.5">Quick Stats</div>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { label: "Blocks", value: blocks.length },
              { label: "Words", value: wordCount },
              { label: "Chars", value: charCount },
            ].map(({ label, value }) => (
              <div key={label} className="rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2 py-1.5 text-center">
                <div className="text-[8px] text-[var(--theme-text-muted)] opacity-60 uppercase">{label}</div>
                <div className="text-xs font-black text-[var(--theme-text)] tabular-nums">{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
