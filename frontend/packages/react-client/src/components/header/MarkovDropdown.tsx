import React from "react";
import Icon from "../Icon";
import Dropdown from "../ui/Dropdown";
import Tooltip from "../ui/Tooltip";
import Toggle from "../ui/Toggle";

interface MarkovDropdownProps {
  isGenerating: boolean;
  selectedModel: string;
  availableModels: string[];
  setSelectedModel: (model: string) => void;
  genOptions: {
    length: number;
    useHybrid: boolean;
    temperature: number;
    top_p: number;
    nGram: number;
    fractalDepth: number;
    fractalProb: number;
  };
  setGenOptions: React.Dispatch<
    React.SetStateAction<{
      length: number;
      useHybrid: boolean;
      temperature: number;
      top_p: number;
      nGram: number;
      fractalDepth: number;
      fractalProb: number;
    }>
  >;
  onGenerate: (withInput: boolean, useStream: boolean) => void;
  onAction: (method: string, options?: any) => void;
}

const MarkovDropdown: React.FC<MarkovDropdownProps> = ({
  isGenerating,
  selectedModel,
  availableModels,
  setSelectedModel,
  genOptions,
  setGenOptions,
  onGenerate,
  onAction,
}) => {
  return (
    <Dropdown
      label="Markov Engine"
      subLabel={
        isGenerating ? "Processing..." : selectedModel.replace(/_/g, " ")
      }
      icon={isGenerating ? "activity" : "sparkles"}
    >
      {/* Models Section */}
      <div
        className="px-4 pb-2 mb-2 border-b"
        style={{ borderBottomColor: "var(--theme-border)" }}
      >
        <span
          className="text-[9px] font-black uppercase tracking-widest"
          style={{ color: "var(--theme-text-muted)" }}
        >
          Models
        </span>
        <div className="mt-2 grid grid-cols-1 gap-1">
          {availableModels.map((m) => (
            <button
              key={m}
              onClick={() => setSelectedModel(m)}
              className={`text-left px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${selectedModel === m ? "" : "hover:bg-slate-500/10"}`}
              style={{
                backgroundColor:
                  selectedModel === m ? "var(--theme-primary)" : "transparent",
                color: selectedModel === m ? "#fff" : "var(--theme-text)",
              }}
            >
              {m.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      </div>

      {/* Markov Settings */}
      <div
        className="px-4 py-2 space-y-3 border-b overflow-y-auto max-h-[400px]"
        style={{ borderBottomColor: "var(--theme-border)" }}
      >
        <div className="py-1">
          <Toggle
            label="Hybrid Mode"
            checked={genOptions.useHybrid}
            onChange={(val) => setGenOptions((p) => ({ ...p, useHybrid: val }))}
          />
        </div>

        <div className="space-y-1">
          <div
            className="flex justify-between text-[9px] font-bold"
            style={{ color: "var(--theme-text-muted)" }}
          >
            <span>Temperature</span>
            <span>{genOptions.temperature}</span>
          </div>
          <input
            type="range"
            min="0.1"
            max="2.0"
            step="0.1"
            value={genOptions.temperature}
            onChange={(e) =>
              setGenOptions((p) => ({
                ...p,
                temperature: parseFloat(e.target.value),
              }))
            }
            className="w-full h-1 rounded-lg appearance-none cursor-pointer"
            style={{
              backgroundColor: "var(--theme-bg)",
              accentColor: "var(--theme-primary)",
            }}
          />
        </div>

        <div className="space-y-1">
          <div
            className="flex justify-between text-[9px] font-bold"
            style={{ color: "var(--theme-text-muted)" }}
          >
            <span>Top-P Sampling</span>
            <span>{genOptions.top_p}</span>
          </div>
          <input
            type="range"
            min="0.1"
            max="1.0"
            step="0.05"
            value={genOptions.top_p}
            onChange={(e) =>
              setGenOptions((p) => ({
                ...p,
                top_p: parseFloat(e.target.value),
              }))
            }
            className="w-full h-1 rounded-lg appearance-none cursor-pointer"
            style={{
              backgroundColor: "var(--theme-bg)",
              accentColor: "var(--theme-primary)",
            }}
          />
        </div>

        <div className="space-y-1">
          <div
            className="flex justify-between text-[9px] font-bold"
            style={{ color: "var(--theme-text-muted)" }}
          >
            <span>Token Length</span>
            <span>{genOptions.length}</span>
          </div>
          <input
            type="range"
            min="50"
            max="1000"
            step="50"
            value={genOptions.length}
            onChange={(e) =>
              setGenOptions((p) => ({ ...p, length: parseInt(e.target.value) }))
            }
            className="w-full h-1 rounded-lg appearance-none cursor-pointer"
            style={{
              backgroundColor: "var(--theme-bg)",
              accentColor: "var(--theme-primary)",
            }}
          />
        </div>

        <div className="space-y-1">
          <div
            className="flex justify-between text-[9px] font-bold"
            style={{ color: "var(--theme-text-muted)" }}
          >
            <span>N-Gram Context</span>
            <span>{genOptions.nGram}</span>
          </div>
          <input
            type="range"
            min="1"
            max="5"
            step="1"
            value={genOptions.nGram}
            onChange={(e) =>
              setGenOptions((p) => ({ ...p, nGram: parseInt(e.target.value) }))
            }
            className="w-full h-1 rounded-lg appearance-none cursor-pointer"
            style={{
              backgroundColor: "var(--theme-bg)",
              accentColor: "var(--theme-primary)",
            }}
          />
        </div>

        {/* Fractal Section */}
        <div
          className="pt-2 border-t space-y-3"
          style={{ borderTopColor: "var(--theme-border)" }}
        >
          <div className="px-0 pb-1">
            <span
              className="text-[9px] font-black uppercase tracking-widest"
              style={{ color: "var(--theme-text-muted)" }}
            >
              Fractal Engine
            </span>
          </div>

          <div className="space-y-1">
            <div
              className="flex justify-between text-[9px] font-bold"
              style={{ color: "var(--theme-text-muted)" }}
            >
              <span>Recursion Depth</span>
              <span>{genOptions.fractalDepth}</span>
            </div>
            <input
              type="range"
              min="1"
              max="10"
              step="1"
              value={genOptions.fractalDepth}
              onChange={(e) =>
                setGenOptions((p) => ({
                  ...p,
                  fractalDepth: parseInt(e.target.value),
                }))
              }
              className="w-full h-1 rounded-lg appearance-none cursor-pointer"
              style={{
                backgroundColor: "var(--theme-bg)",
                accentColor: "var(--theme-warning)",
              }}
            />
          </div>

          <div className="space-y-1">
            <div
              className="flex justify-between text-[9px] font-bold"
              style={{ color: "var(--theme-text-muted)" }}
            >
              <span>Branch Probability</span>
              <span>{genOptions.fractalProb}</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              value={genOptions.fractalProb}
              onChange={(e) =>
                setGenOptions((p) => ({
                  ...p,
                  fractalProb: parseFloat(e.target.value),
                }))
              }
              className="w-full h-1 rounded-lg appearance-none cursor-pointer"
              style={{
                backgroundColor: "var(--theme-bg)",
                accentColor: "var(--theme-warning)",
              }}
            />
          </div>
        </div>
      </div>

      {/* Generation Actions */}
      <div className="px-2 pt-2 space-y-1">
        <div className="px-2 pb-1">
          <span
            className="text-[9px] font-black uppercase tracking-widest"
            style={{ color: "var(--theme-text-muted)" }}
          >
            Generation
          </span>
        </div>
        <button
          onClick={() => onGenerate(false, true)}
          disabled={isGenerating}
          className="w-full text-left px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:opacity-80 transition-opacity"
          style={{ color: "var(--theme-primary)" }}
        >
          <Icon name="sparkles" size="sm" /> Stream Story
        </button>
        <button
          onClick={() => onGenerate(true, false)}
          disabled={isGenerating}
          className="w-full text-left px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:opacity-80 transition-opacity"
          style={{ color: "var(--theme-text)" }}
        >
          <Icon name="edit" size="sm" /> Continue text
        </button>

        <div
          className="h-px my-1"
          style={{ backgroundColor: "var(--theme-border)" }}
        />

        <Tooltip content="Recursive Markov Generator">
          <button
            onClick={() =>
              onAction("fractal_generator", {
                model: selectedModel,
                depth: genOptions.fractalDepth,
                probability: genOptions.fractalProb,
              })
            }
            disabled={isGenerating}
            className="w-full text-left px-3 py-2 rounded-lg text-[10px] font-bold flex items-center gap-2 hover:opacity-80 transition-opacity"
            style={{ color: "var(--theme-warning)" }}
          >
            <Icon name="tree" size="sm" /> Gen. Fractal
          </button>
        </Tooltip>
      </div>
    </Dropdown>
  );
};

export default MarkovDropdown;
