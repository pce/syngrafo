import { useState, useCallback } from "react";
import type { BlockKind, ParamValue } from "@syngrafo/audio";
import { BLOCK_REGISTRY, BLOCK_KINDS, usePatch } from "@syngrafo/audio";
import { BlockCard } from "./BlockCard";
import { PatchMatrixView } from "./PatchMatrixView";

const KIND_LABELS: Record<BlockKind, string> = {
  grainade:       "⬡ GrainadeBlock",
  signalFollower: "⌁ SignalFollower",
  dataTransform:  "⊕ DataTransform",
  scaleQuantizer: "♩ ScaleQuantizer",
  samplePlayer:   "▶ SamplePlayer",
  grispChips:     "⬢ GrispChips",
  eq3:            "≋ EQ3",
  delay:          "↺ Delay",
  beatDetector:   "◉ BeatDetector",
  xyPad:          "⊕ XY Pad",
};

const ENGINE_BADGE: Record<string, string> = {
  idle:    "bg-gray-700 text-gray-400",
  loading: "bg-yellow-900 text-yellow-300",
  ready:   "bg-green-900  text-green-300",
  playing: "bg-blue-900   text-blue-300",
  error:   "bg-red-900    text-red-300",
};

export function PatchWorkstation() {
  const {
    patch,
    addBlock,
    removeBlock,
    setParam,
    addCable,
    removeCable,
    setCableTransform,
    startEngine,
    stopEngine,
    trigger,
    setXY,
    isPlaying,
    engineState,
  } = usePatch();

  const [selectedId,  setSelectedId]  = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [rightTab,    setRightTab]    = useState<"matrix" | "xy">("matrix");

  const handleAddBlock = useCallback(
    (kind: BlockKind) => {
      addBlock(kind);
      setAddMenuOpen(false);
    },
    [addBlock],
  );

  const handleParam = useCallback(
    (blockId: string, paramId: string, value: ParamValue) => {
      setParam(blockId, paramId, value);
    },
    [setParam],
  );

  const handleXY = useCallback(
    (blockId: string, x: number, y: number) => {
      setXY(blockId, x, y);
    },
    [setXY],
  );

  const xyBlocks = patch.blocks.filter(b => b.kind === "xyPad");

  return (
    <div className="h-full flex flex-col bg-[var(--theme-bg)] overflow-hidden">

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--theme-surface)] border-b border-[var(--theme-border)] shrink-0">
        <span className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)]">
          Patcher
        </span>

        {/* Add block menu */}
        <div className="relative">
          <button
            onClick={() => setAddMenuOpen(v => !v)}
            className="text-[10px] px-2 py-1 rounded border border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-text)] hover:border-[var(--theme-primary)] transition-colors"
          >
            + Block
          </button>

          {addMenuOpen && (
            <>
              {/* Click-away backdrop */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => setAddMenuOpen(false)}
              />
              <div className="absolute left-0 top-full mt-1 z-50 bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded shadow-xl min-w-[160px] py-1 flex flex-col">
                {BLOCK_KINDS.map(kind => (
                  <button
                    key={kind}
                    className="text-left text-[10px] px-3 py-1.5 hover:bg-[var(--theme-bg)] text-[var(--theme-text)] flex items-center gap-2"
                    onClick={() => handleAddBlock(kind)}
                  >
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: BLOCK_REGISTRY[kind].color }}
                    />
                    {KIND_LABELS[kind]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex-1" />

        {/* Right-panel tab toggle */}
        <div className="flex rounded border border-[var(--theme-border)] overflow-hidden text-[9px]">
          {(["matrix", "xy"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setRightTab(tab)}
              className={[
                "px-2 py-1 transition-colors uppercase tracking-wider font-semibold",
                rightTab === tab
                  ? "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)]"
                  : "text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]",
              ].join(" ")}
            >
              {tab === "matrix" ? "Matrix" : "XY Pads"}
            </button>
          ))}
        </div>

        {/* Engine play/stop */}
        <button
          onClick={isPlaying ? stopEngine : startEngine}
          disabled={engineState === "loading"}
          className={[
            "text-[10px] px-2 py-1 rounded font-semibold transition-colors disabled:opacity-40",
            isPlaying
              ? "bg-red-900/40 text-red-300 border border-red-800 hover:bg-red-900/60"
              : "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] hover:opacity-90",
          ].join(" ")}
        >
          {isPlaying ? "⏹ Stop" : "▶ Compile+Play"}
        </button>

        {/* Engine state badge */}
        <span
          className={`text-[9px] px-2 py-0.5 rounded-full font-mono ${ENGINE_BADGE[engineState] ?? ENGINE_BADGE["idle"]}`}
        >
          {engineState}
        </span>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left panel — block list */}
        <aside className="w-56 shrink-0 border-r border-[var(--theme-border)] bg-[var(--theme-surface)] flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
            {patch.blocks.length === 0 ? (
              <p className="text-[10px] text-[var(--theme-text-muted)] text-center mt-8 px-2">
                Click <strong>+ Block</strong> to start patching
              </p>
            ) : (
              patch.blocks.map(block => (
                <BlockCard
                  key={block.id}
                  block={block}
                  typeDef={BLOCK_REGISTRY[block.kind]}
                  cables={patch.cables}
                  selected={selectedId === block.id}
                  onSelect={setSelectedId}
                  onRemove={removeBlock}
                  onParam={handleParam}
                  onXY={handleXY}
                  onTrigger={trigger}
                />
              ))
            )}
          </div>
        </aside>

        {/* Right panel — pin matrix or XY pads */}
        <main className="flex-1 min-w-0 overflow-auto p-3">
          {rightTab === "matrix" ? (
            <PatchMatrixView
              patch={patch}
              onAddCable={addCable}
              onRemoveCable={removeCable}
              onSetTransform={setCableTransform}
            />
          ) : (
            <div className="flex flex-wrap gap-4 p-2">
              {xyBlocks.length === 0 ? (
                <p className="text-[10px] text-[var(--theme-text-muted)]">
                  Add an <strong>XY Pad</strong> block to see it here
                </p>
              ) : (
                xyBlocks.map(block => {
                  const def = BLOCK_REGISTRY[block.kind];
                  return (
                    <div
                      key={block.id}
                      className="flex flex-col gap-1 items-center"
                    >
                      <span className="text-[9px] text-[var(--theme-text-muted)] uppercase tracking-wider">
                        {block.label}
                      </span>
                      <BlockCard
                        block={block}
                        typeDef={def}
                        cables={patch.cables}
                        selected={selectedId === block.id}
                        onSelect={setSelectedId}
                        onRemove={removeBlock}
                        onParam={handleParam}
                        onXY={handleXY}
                      />
                    </div>
                  );
                })
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
