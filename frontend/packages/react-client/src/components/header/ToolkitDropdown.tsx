import React, { useState } from "react";
import Icon from "../Icon";
import Dropdown from "../ui/Dropdown";
import Toggle from "../ui/Toggle";

interface ToolkitDropdownProps {
  onAction: (method: string, options?: any) => void;
}

/**
 * ToolkitDropdown Component
 * Handles experimental text processing features like Deduplication.
 * Includes domain-dependent presets and custom preset management.
 */
const ToolkitDropdown: React.FC<ToolkitDropdownProps> = ({ onAction }) => {
  const [customPresets, setCustomPresets] = useState<Record<string, any>>(
    () => {
      const saved = localStorage.getItem("nlp-custom-presets");
      return saved ? JSON.parse(saved) : {};
    },
  );

  const [params, setParams] = useState({
    minLength: 3,
    skipWords: "",
    ignoreQuotes: true,
    ignorePunct: true,
  });

  const handleToggleParam = (key: keyof typeof params) => {
    setParams((p) => ({ ...p, [key]: !p[key] }));
  };

  const applyPreset = (type: string) => {
    const builtIn: Record<string, any> = {
      general: {
        minLength: 3,
        skipWords:
          "the,a,an,and,or,but,is,are,was,were,of,it,this,that,to,for,with,in,on,at",
        ignorePunct: true,
      },
      academic: {
        minLength: 5,
        skipWords:
          "however,therefore,furthermore,consequently,notably,suggests,indicates,analysis",
        ignorePunct: true,
      },
      creative: {
        minLength: 4,
        skipWords: "suddenly,shadows,whispered,ancient,beneath,echoed,silence",
        ignorePunct: true,
      },
      code: {
        minLength: 2,
        skipWords:
          "const,let,var,function,return,import,export,from,class,public,private",
        ignorePunct: false,
      },
      strict: {
        minLength: 1,
        skipWords: ".,:?!",
        ignorePunct: false,
      },
    };

    const preset = customPresets[type] || builtIn[type];
    if (preset) {
      setParams({ ...params, ...preset });
    }
  };

  const saveCurrentAsPreset = () => {
    const name = prompt("Enter a name for this domain preset:");
    if (!name) return;
    const newPresets = {
      ...customPresets,
      [name.toLowerCase()]: { ...params },
    };
    setCustomPresets(newPresets);
    localStorage.setItem("nlp-custom-presets", JSON.stringify(newPresets));
  };

  const deletePreset = (name: string) => {
    const newPresets = { ...customPresets };
    delete newPresets[name];
    setCustomPresets(newPresets);
    localStorage.setItem("nlp-custom-presets", JSON.stringify(newPresets));
  };

  const getDedupeOptions = (mode: string) => ({
    mode,
    min_length: params.minLength.toString(),
    skip_words: params.skipWords,
    ignore_quotes: params.ignoreQuotes ? "true" : "false",
    ignore_punctuation: params.ignorePunct ? "true" : "false",
  });

  return (
    <Dropdown
      label="Toolkit"
      subLabel="Deduplicator"
      icon="settings"
      variant="warning"
      width="w-80"
    >
      <div
        className="px-4 pb-2 mb-2 border-b"
        style={{ borderBottomColor: "var(--theme-border)" }}
      >
        <div className="flex flex-col gap-2">
          <span
            className="text-[9px] font-black uppercase tracking-widest"
            style={{ color: "var(--theme-text-muted)" }}
          >
            Domain Presets
          </span>
          <div className="flex flex-wrap gap-1">
            {["general", "academic", "creative", "code", "strict"].map((p) => (
              <button
                key={p}
                onClick={() => applyPreset(p)}
                className="px-2 py-1 rounded text-[7px] font-black uppercase bg-slate-500/10 hover:bg-slate-500/20 transition-all border border-transparent hover:border-slate-400/20"
                style={{ color: "var(--theme-text-muted)" }}
              >
                {p}
              </button>
            ))}
            {Object.keys(customPresets).map((p) => (
              <div key={p} className="flex items-center gap-0.5 group/preset">
                <button
                  onClick={() => applyPreset(p)}
                  className="px-2 py-1 rounded text-[7px] font-black uppercase bg-indigo-500/10 hover:bg-indigo-500/20 transition-all border border-indigo-400/20"
                  style={{ color: "var(--theme-primary)" }}
                >
                  {p}
                </button>
                <button
                  onClick={() => deletePreset(p)}
                  className="opacity-0 group-hover/preset:opacity-100 p-1 text-rose-500 hover:text-rose-600 transition-all"
                >
                  <Icon name="close" size="xs" />
                </button>
              </div>
            ))}
            <button
              onClick={saveCurrentAsPreset}
              className="px-2 py-1 rounded text-[7px] font-black uppercase border border-dashed border-slate-400/40 text-slate-400 hover:text-slate-600 hover:border-slate-600 transition-all"
            >
              + NEW
            </button>
          </div>
        </div>
      </div>

      <div className="px-2 space-y-1">
        <div className="grid grid-cols-2 gap-1 px-1 mb-2">
          <button
            onClick={() => onAction("deduplicator", getDedupeOptions("detect"))}
            className="flex flex-col items-center justify-center p-3 rounded-xl border border-transparent bg-indigo-500/5 hover:bg-indigo-500/10 transition-all group"
            style={{ color: "var(--theme-primary)" }}
          >
            <Icon
              name="search"
              size="sm"
              className="mb-1 group-hover:scale-110 transition-transform"
            />
            <span className="text-[8px] font-black uppercase tracking-widest">
              Find Dups
            </span>
          </button>
          <button
            onClick={() => onAction("deduplicator", getDedupeOptions("remove"))}
            className="flex flex-col items-center justify-center p-3 rounded-xl border border-transparent bg-rose-500/5 hover:bg-rose-500/10 transition-all group"
            style={{ color: "var(--theme-danger)" }}
          >
            <Icon
              name="trash"
              size="sm"
              className="mb-1 group-hover:scale-110 transition-transform"
            />
            <span className="text-[8px] font-black uppercase tracking-widest">
              Delete Dups
            </span>
          </button>
        </div>

        <div
          className="h-px mb-2"
          style={{ backgroundColor: "var(--theme-border)" }}
        />

        {/* Parameter Settings */}
        <div
          className="p-3 rounded-xl space-y-4"
          style={{ backgroundColor: "var(--theme-bg)" }}
        >
          <div className="space-y-1">
            <div
              className="flex justify-between text-[9px] font-bold"
              style={{ color: "var(--theme-text-muted)" }}
            >
              <span>Min Segment Length</span>
              <span>{params.minLength}</span>
            </div>
            <input
              type="range"
              min="1"
              max="20"
              value={params.minLength}
              onChange={(e) =>
                setParams({ ...params, minLength: parseInt(e.target.value) })
              }
              className="w-full h-1 rounded-lg appearance-none cursor-pointer accent-amber-500"
              style={{ backgroundColor: "var(--theme-border)" }}
            />
          </div>

          <div className="space-y-1">
            <span
              className="text-[9px] font-black uppercase tracking-widest"
              style={{ color: "var(--theme-text-muted)" }}
            >
              Skip Words / Domain Tokens
            </span>
            <input
              type="text"
              value={params.skipWords}
              onChange={(e) =>
                setParams({ ...params, skipWords: e.target.value })
              }
              placeholder="word1,word2..."
              className="w-full px-2 py-1.5 rounded-lg text-[10px] font-bold bg-transparent border focus:outline-none focus:border-amber-500"
              style={{
                color: "var(--theme-text)",
                borderColor: "var(--theme-border)",
              }}
            />
          </div>

          <div className="flex flex-col gap-3">
            <Toggle
              label="Ignore Quotes"
              checked={params.ignoreQuotes}
              onChange={() => handleToggleParam("ignoreQuotes")}
              size="sm"
            />

            <Toggle
              label="Ignore Punctuation"
              checked={params.ignorePunct}
              onChange={() => handleToggleParam("ignorePunct")}
              size="sm"
            />
          </div>
        </div>
      </div>
    </Dropdown>
  );
};

export default ToolkitDropdown;
