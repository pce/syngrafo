/**
 * VCS3-style modular patcher.
 *
 * One patch is active at a time. On engine start a {@link PatchRuntime} is
 * registered in {@link PatchStoreProvider} so the StepSequencer can call
 * `triggerPatch(patchId)` from any PatternBlock track.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useLingui } from "@lingui/react";
import { i18n } from "@/i18n";
import { dms } from "@/services/dms-service";
import type { BlockKind, ParamValue } from "@syngrafo/audio";
import { BLOCK_REGISTRY, BLOCK_KINDS, usePatch, patchEngine } from "@syngrafo/audio";
import { fileService, generateName } from "@syngrafo/shared";
import { BlockCard } from "./BlockCard";
import { PatchMatrixView } from "./PatchMatrixView";
import { usePatchStore } from "@/store/patch-store";
import { ResizablePanel } from "@syngrafo/ui";
import { exportPatchPreset, isPatchPresetFile, slugifyPresetName } from "../presets";

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

/** classes for the engine-state badge. */
const ENGINE_BADGE: Record<string, string> = {
  idle:    "bg-gray-700 text-gray-400",
  loading: "bg-yellow-900 text-yellow-300",
  ready:   "bg-green-900  text-green-300",
  playing: "bg-blue-900   text-blue-300",
  error:   "bg-red-900    text-red-300",
};

export function PatchWorkstation() {
  const patchStore = usePatchStore();
  useLingui();

  const [activePatchEntryId, setActivePatchEntryId] = useState<string | null>(null);
  const [newPatchName,       setNewPatchName]       = useState("");
  const [renamingId,         setRenamingId]         = useState<string | null>(null);
  const [renameValue,        setRenameValue]        = useState("");
  const [patchStatus,        setPatchStatus]        = useState<string | null>(null);

  useEffect(() => {
    if (patchStore.patches.length === 0) {
      const entry = patchStore.createPatch(i18n._({ id: "Default Patch", message: "Default Patch" }));
      setActivePatchEntryId(entry.id);
    } else if (!activePatchEntryId) {
      setActivePatchEntryId(patchStore.patches[0]!.id);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    patch, addBlock, removeBlock, setParam,
    addCable, removeCable, setCableTransform,
    startEngine, stopEngine, trigger, setXY, loadPatch,
    isPlaying, engineState,
  } = usePatch(
    activePatchEntryId
      ? patchStore.patches.find(e => e.id === activePatchEntryId)?.patch
      : undefined
  );

  useEffect(() => {
    if (activePatchEntryId) patchStore.updatePatch(activePatchEntryId, patch);
  }, [patch, activePatchEntryId]); // eslint-disable-line react-hooks/exhaustive-deps

  const triggerRef = useRef(trigger);
  useEffect(() => { triggerRef.current = trigger; }, [trigger]);

  // Registers a PatchRuntime so the StepSequencer can trigger this patch by id.
  useEffect(() => {
    if (!activePatchEntryId) return;
    patchStore.registerRuntime(activePatchEntryId, {
      isPlaying,
      trigger: (blockId?: string, duration = 0.5) => {
        if (blockId) triggerRef.current(blockId, duration);
        else patchEngine.triggerAnyInstrument(duration);
      },
    });
    return () => {
      if (activePatchEntryId) patchStore.unregisterRuntime(activePatchEntryId);
    };
  }, [activePatchEntryId, isPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectPatch = useCallback((entryId: string) => {
    const entry = patchStore.patches.find(e => e.id === entryId);
    if (!entry) return;
    loadPatch(entry.patch);
    setActivePatchEntryId(entryId);
  }, [patchStore.patches, loadPatch]);

  const handleCreatePatch = useCallback(() => {
    const name  = newPatchName.trim() || generateName();
    const entry = patchStore.createPatch(name);
    loadPatch(entry.patch);
    setActivePatchEntryId(entry.id);
    setNewPatchName("");
  }, [newPatchName, patchStore, loadPatch]);

  const handleLoadPatchPreset = useCallback(async () => {
    const picked = await fileService.selectFiles();
    const path = picked.ok ? picked.data?.[0] : undefined;
    if (!path) return;
    const loaded = await dms.readFile(path);
    const content = loaded.ok ? loaded.data?.content : null;
    if (!content) {
      setPatchStatus(i18n._({ id: "Could not read patch preset file.", message: "Could not read patch preset file." }));
      return;
    }
    try {
      const parsed = JSON.parse(content) as unknown;
      if (!isPatchPresetFile(parsed)) {
        setPatchStatus(i18n._({ id: "Selected file is not a patch preset.", message: "Selected file is not a patch preset." }));
        return;
      }
      const existing = patchStore.patches.find((entry) => entry.name === parsed.name);
      const entry = existing ?? patchStore.createPatch(parsed.name);
      patchStore.renamePatch(entry.id, parsed.name);
      patchStore.updatePatch(entry.id, parsed.patch);
      loadPatch(parsed.patch);
      setActivePatchEntryId(entry.id);
      setPatchStatus(i18n._({ id: "Loaded patch preset", message: "Loaded patch preset" }) + `: ${parsed.name}`);
    } catch {
      setPatchStatus(i18n._({ id: "Patch preset file is not valid JSON.", message: "Patch preset file is not valid JSON." }));
    }
  }, [patchStore, loadPatch]);

  const handleSavePatchPreset = useCallback(async () => {
    const activeEntry = patchStore.patches.find((entry) => entry.id === activePatchEntryId);
    if (!activeEntry) return;
    const save = await fileService.selectSavePath(`${slugifyPresetName(activeEntry.name)}.sygpatch.json`, "json");
    const path = save.ok ? save.data?.path : undefined;
    if (!path) return;
    const preset = exportPatchPreset(activeEntry.name, activeEntry.patch, slugifyPresetName(activeEntry.name));
    const written = await dms.writeFile(path, JSON.stringify(preset, null, 2));
    setPatchStatus(
      written.ok
        ? `${i18n._({ id: "Saved patch preset", message: "Saved patch preset" })}: ${path}`
        : (written.error ?? i18n._({ id: "Failed to save patch preset.", message: "Failed to save patch preset." }))
    );
  }, [activePatchEntryId, patchStore.patches]);

  const handleRemovePatch = useCallback((entryId: string) => {
    patchStore.removePatch(entryId);
    if (activePatchEntryId !== entryId) return;
    const remaining = patchStore.patches.filter(e => e.id !== entryId);
    if (remaining.length > 0) {
      handleSelectPatch(remaining[0]!.id);
    } else {
      const fresh = patchStore.createPatch(i18n._({ id: "Default Patch", message: "Default Patch" }));
      loadPatch(fresh.patch);
      setActivePatchEntryId(fresh.id);
    }
  }, [activePatchEntryId, patchStore, handleSelectPatch, loadPatch]);

  const [selectedId,  setSelectedId]  = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [leftTab,     setLeftTab]     = useState<"patterns" | "patches">("patterns");
  const [rightTab,    setRightTab]    = useState<"matrix" | "xy">("matrix");

  const handleAddBlock = useCallback(
    (kind: BlockKind) => { addBlock(kind); setAddMenuOpen(false); },
    [addBlock],
  );
  const handleParam = useCallback(
    (blockId: string, paramId: string, value: ParamValue) => setParam(blockId, paramId, value),
    [setParam],
  );
  const handleXY = useCallback(
    (blockId: string, x: number, y: number) => setXY(blockId, x, y),
    [setXY],
  );

  const xyBlocks    = patch.blocks.filter(b => b.kind === "xyPad");
  const activeEntry = patchStore.patches.find(e => e.id === activePatchEntryId);

  return (
    <div className="h-full flex flex-col bg-[var(--theme-bg)] overflow-hidden">

      <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--theme-surface)] border-b border-[var(--theme-border)] shrink-0 flex-wrap gap-y-1">
        <span className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)]">
          {i18n._({ id: "Patcher", message: "Patcher" })}
        </span>

        <button
          onClick={() => setLeftTab("patches")}
          className="text-[10px] px-2 py-1 rounded border border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-text)] hover:border-[var(--theme-primary)] transition-colors flex items-center gap-1 max-w-[160px]"
          title={i18n._({ id: "Browse patches in the left panel", message: "Browse patches in the left panel" })}
        >
          <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-[var(--theme-primary)]" />
          <span className="truncate flex-1">{activeEntry?.name ?? i18n._({ id: "No patch", message: "No patch" })}</span>
        </button>

        <div className="relative">
          <button
            onClick={() => setAddMenuOpen(v => !v)}
            className="text-[10px] px-2 py-1 rounded border border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-text)] hover:border-[var(--theme-primary)] transition-colors"
          >
            {i18n._({ id: "+ PatternBlock", message: "+ PatternBlock" })}
          </button>
          {addMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setAddMenuOpen(false)} />
              <div className="absolute left-0 top-full mt-1 z-50 bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded shadow-xl min-w-[160px] py-1 flex flex-col">
                {BLOCK_KINDS.map(kind => (
                  <button
                    key={kind}
                    className="text-left text-[10px] px-3 py-1.5 hover:bg-[var(--theme-bg)] text-[var(--theme-text)] flex items-center gap-2"
                    onClick={() => handleAddBlock(kind)}
                  >
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: BLOCK_REGISTRY[kind].color }} />
                    {KIND_LABELS[kind]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex-1" />

        {patchStore.patches.length > 1 && (
          <span className="text-[9px] text-[var(--theme-text-muted)] hidden sm:block">
            {patchStore.patches.length} {i18n._({ id: "patches", message: "patches" })}
          </span>
        )}

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
              {tab === "matrix" ? i18n._({ id: "Matrix", message: "Matrix" }) : i18n._({ id: "XY Pads", message: "XY Pads" })}
            </button>
          ))}
        </div>

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
          {isPlaying ? `⏹ ${i18n._({ id: "Stop", message: "Stop" })}` : `▶ ${i18n._({ id: "Compile+Play", message: "Compile+Play" })}`}
        </button>

        <span className={`text-[9px] px-2 py-0.5 rounded-full font-mono ${ENGINE_BADGE[engineState] ?? ENGINE_BADGE["idle"]}`}>
          {engineState}
        </span>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">

        <ResizablePanel
          label={leftTab === "patches" ? i18n._({ id: "Patches", message: "Patches" }) : i18n._({ id: "Patterns", message: "Patterns" })}
          side="left"
          defaultWidth={224}
          minWidth={160}
          maxWidth={360}
          headerExtra={
            <div className="flex rounded overflow-hidden border border-[var(--theme-border)] text-[9px]">
              {(["patterns", "patches"] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setLeftTab(tab)}
                  className={[
                    "px-2 py-0.5 capitalize transition-colors",
                    leftTab === tab
                      ? "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] font-semibold"
                      : "text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]",
                  ].join(" ")}
                >
                  {tab === "patterns" ? i18n._({ id: "Patterns", message: "Patterns" }) : i18n._({ id: "Patches", message: "Patches" })}
                </button>
              ))}
            </div>
          }
        >
          {leftTab === "patterns" ? (
            <div className="flex flex-col h-full overflow-hidden">
              <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
                {patch.blocks.length === 0 ? (
                  <p className="text-[10px] text-[var(--theme-text-muted)] text-center mt-8 px-2">
                    {i18n._({ id: "Click + PatternBlock to start patching", message: "Click + PatternBlock to start patching" })}
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
              <div className="px-2 py-1.5 border-t border-[var(--theme-border)] shrink-0">
                <p className="text-[9px] text-[var(--theme-text-muted)] leading-snug">
                  {i18n._({ id: "Add a PatchBlock track in the Sequencer and pick this patch.", message: "Add a PatchBlock track in the Sequencer and pick this patch." })}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full overflow-hidden">
              <div className="flex-1 overflow-y-auto flex flex-col">
                {patchStore.patches.map(entry => (
                  <div
                    key={entry.id}
                    className={[
                      "group flex items-center gap-1 px-2 py-1.5 border-b border-[var(--theme-border)]/50",
                      "hover:bg-[var(--theme-bg)] transition-colors",
                      entry.id === activePatchEntryId ? "bg-[var(--theme-primary)]/10" : "",
                    ].join(" ")}
                  >
                    <span className={[
                      "w-1.5 h-1.5 rounded-full shrink-0 transition-colors",
                      entry.id === activePatchEntryId
                        ? "bg-[var(--theme-primary)]"
                        : "bg-[var(--theme-border)]",
                    ].join(" ")} />

                    {renamingId === entry.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={() => {
                          patchStore.renamePatch(renamingId, renameValue.trim() || entry.name);
                          setRenamingId(null);
                        }}
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            patchStore.renamePatch(entry.id, renameValue.trim() || entry.name);
                            setRenamingId(null);
                          }
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        className="flex-1 text-[10px] bg-[var(--theme-bg)] border border-[var(--theme-primary)] rounded px-1 py-0.5 outline-none"
                      />
                    ) : (
                      <button
                        className={[
                          "flex-1 text-left text-[10px] truncate",
                          entry.id === activePatchEntryId
                            ? "text-[var(--theme-primary)] font-semibold"
                            : "text-[var(--theme-text)]",
                        ].join(" ")}
                        onClick={() => handleSelectPatch(entry.id)}
                        onDoubleClick={() => { setRenamingId(entry.id); setRenameValue(entry.name); }}
                        title={i18n._({ id: "Click to load · double-click to rename", message: "Click to load · double-click to rename" })}
                      >
                        {entry.name}
                      </button>
                    )}

                    <span className="text-[9px] text-[var(--theme-text-muted)] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      {entry.patch.blocks.length}b
                    </span>

                    <button
                      onClick={() => handleRemovePatch(entry.id)}
                      className="text-[10px] text-[var(--theme-text-muted)] hover:text-red-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity px-0.5"
                      title={i18n._({ id: "Delete patch", message: "Delete patch" })}
                    >×</button>
                  </div>
                ))}
              </div>

              <div className="border-t border-[var(--theme-border)] p-2 flex flex-col gap-1.5 shrink-0">
                <div className="flex gap-1.5">
                  <button
                    onClick={() => void handleLoadPatchPreset()}
                    className="flex-1 text-[10px] px-2 py-1 rounded border border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:border-[var(--theme-primary)] transition-colors"
                  >
                    {i18n._({ id: "Load Patch", message: "Load Patch" })}
                  </button>
                  <button
                    onClick={() => void handleSavePatchPreset()}
                    disabled={!activePatchEntryId}
                    className="flex-1 text-[10px] px-2 py-1 rounded border border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:border-[var(--theme-primary)] disabled:opacity-40 transition-colors"
                  >
                    {i18n._({ id: "Save Patch", message: "Save Patch" })}
                  </button>
                </div>
                <input
                  placeholder={i18n._({ id: "New patch name\\u2026", message: "New patch name\\u2026" })}
                  value={newPatchName}
                  onChange={e => setNewPatchName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleCreatePatch(); }}
                  className="text-[10px] bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded px-2 py-1 outline-none text-[var(--theme-text)] focus:border-[var(--theme-primary)]"
                />
                <button
                  onClick={handleCreatePatch}
                  className="text-[10px] px-2 py-1 rounded bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] font-semibold hover:opacity-90"
                >
                  {i18n._({ id: "+ New Patch", message: "+ New Patch" })}
                </button>
                {patchStatus && (
                  <p className="text-[9px] text-[var(--theme-text-muted)] leading-snug">
                    {patchStatus}
                  </p>
                )}
              </div>
            </div>
          )}
        </ResizablePanel>

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
                  {i18n._({ id: "Add an XY Pad block to see it here", message: "Add an XY Pad block to see it here" })}
                </p>
              ) : (
                xyBlocks.map(block => (
                  <div key={block.id} className="flex flex-col gap-1 items-center">
                    <span className="text-[9px] text-[var(--theme-text-muted)] uppercase tracking-wider">
                      {block.label}
                    </span>
                    <BlockCard
                      block={block}
                      typeDef={BLOCK_REGISTRY[block.kind]}
                      cables={patch.cables}
                      selected={selectedId === block.id}
                      onSelect={setSelectedId}
                      onRemove={removeBlock}
                      onParam={handleParam}
                      onXY={handleXY}
                    />
                  </div>
                ))
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
