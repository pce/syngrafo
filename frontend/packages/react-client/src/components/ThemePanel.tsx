import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLingui } from "@lingui/react";
import { i18n } from "@/i18n";
import { useTheme, THEME_PRESETS, FONT_PAIRS } from "../store/theme-store";
import type { ThemePreset, FontPair } from "../store/theme-store";
import { useSettings } from "../store/settings-store";
import { useLocale } from "../store/locale-store";
import { LOCALES, LOCALE_BADGES, type SupportedLocale } from "../i18n";
import { Icon } from "./Icon";
import Toggle from "./ui/Toggle";
import Tooltip from "./ui/Tooltip";
import { models, type LlmModelInfo, type LlmDownloadProgress } from "../services/dms-service";
import { dms } from "../services/dms-service";
import {
  INPUT_MAPPING_PRESETS,
  KEYBOARD_SCHEME_PREF_KEY,
  detectPreferredKeyboardScheme,
  normalizeKeyboardScheme,
  type KeyboardScheme,
} from "@syngrafo/shared";
import { getResolvedPaperStyle, paperStyleBackgroundCss, type PaperStylePreset } from "../models/paper-style";


const COLOR_SLOTS: Array<{ label: string; var: string }> = [
  { label: "Background",    var: "--theme-bg"         },
  { label: "Surface",       var: "--theme-surface"     },
  { label: "Border",        var: "--theme-border"      },
  { label: "Text",          var: "--theme-text"        },
  { label: "Muted Text",    var: "--theme-text-muted"  },
  { label: "Accent",        var: "--theme-primary"     },
  { label: "Danger",        var: "--theme-danger"      },
];

const RADIUS_OPTIONS = [
  { id: "none",   label: "None",   preview: "0" },
  { id: "small",  label: "Small",  preview: "4px" },
  { id: "medium", label: "Medium", preview: "8px" },
  { id: "large",  label: "Large",  preview: "12px" },
  { id: "pill",   label: "Pill",   preview: "∞" },
];

const DENSITY_OPTIONS = [
  { id: "compact", label: "Compact", icon: "▤" },
  { id: "normal",  label: "Normal",  icon: "▥" },
  { id: "roomy",   label: "Roomy",   icon: "▦" },
];


const PresetCard: React.FC<{
  preset: ThemePreset;
  active: boolean;
  onSelect: () => void;
}> = ({ preset, active, onSelect }) => (
  <button
    onClick={onSelect}
  title={preset.name}
    className={`
      group relative flex flex-col gap-1.5 p-2.5 rounded-xl border-2 transition-all text-left
      ${active
        ? "border-[var(--theme-primary)] shadow-lg scale-[1.02]"
        : "border-[var(--theme-border)] hover:border-[var(--theme-primary)]/50 hover:scale-[1.01]"}
    `}
    style={{ background: preset.bg }}
  >
    <div className="flex gap-1">
      {[preset.surface, preset.text, preset.primary, preset.danger].map((c, i) => (
        <span key={i} className="flex-1 h-2 rounded-full" style={{ background: c }} />
      ))}
    </div>
    <span
      className="text-[10px] font-bold uppercase tracking-wider truncate"
      style={{ color: preset.text }}
    >
      {preset.name}
    </span>
    {active && (
      <span
        className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black"
        style={{ background: preset.primary, color: preset.bg }}
      >
        ✓
      </span>
    )}
  </button>
);


interface ThemePanelProps {
  onClose: () => void;
}

type Tab = "appearance" | "colors" | "settings" | "models";


const SVG_SIZE_OPTIONS: Array<{ bytes: number; label: string }> = [
  { bytes:    512_000,     label: "500 KB"  },
  { bytes:  1_048_576,     label: "1 MB"    },
  { bytes:  2_097_152,     label: "2 MB"    },
  { bytes:  4_194_304,     label: "4 MB"    },
  { bytes:  8_388_608,     label: "8 MB"    },
  { bytes: 10_485_760,     label: "10 MB"   },
  { bytes: 20_971_520,     label: "20 MB"   },
  { bytes: 52_428_800,     label: "50 MB"   },
  { bytes: 104_857_600,    label: "100 MB"  },
  { bytes: 209_715_200,    label: "200 MB"  },
];

const ASYNC_COPY_THRESHOLD_OPTIONS: Array<{ bytes: number; label: string }> = [
  { bytes: 0, label: "Always background" },
  { bytes: 134_217_728, label: "128 MB" },
  { bytes: 268_435_456, label: "256 MB" },
  { bytes: 536_870_912, label: "512 MB" },
  { bytes: 1_073_741_824, label: "1 GB" },
  { bytes: 2_147_483_648, label: "2 GB" },
];

const SettingRow: React.FC<{
  label: string;
  help:  string;
  children: React.ReactNode;
}> = ({ label, help, children }) => (
  <div className="flex items-center justify-between gap-3 py-1.5">
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-[11px] font-bold text-[var(--theme-text)] truncate">{label}</span>
      <Tooltip content={help} position="right" multiline>
        <span
          className="flex-shrink-0 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-black cursor-help select-none"
          style={{ background: "var(--theme-border)", color: "var(--theme-text-muted)" }}
        >
          ?
        </span>
      </Tooltip>
    </div>
    <div className="flex-shrink-0">{children}</div>
  </div>
);


const NLP_FEATURES: Array<{ label: string; key: string; model: string; size: string }> = [
  { label: "Embeddings / Semantic Search", key: "hasOnnx",      model: "embed.onnx",     size: "~23 MB"  },
  { label: "Sentiment Analysis",           key: "hasSentiment", model: "sentiment.onnx", size: "~67 MB"  },
  { label: "Named Entity Recognition",     key: "hasNer",       model: "ner.onnx",       size: "~415 MB" },
  { label: "Toxicity Detection",           key: "hasToxicity",  model: "toxicity.onnx",  size: "~415 MB" },
  { label: "OCR",                          key: "hasOcr",       model: "compile-time",   size: "built-in" },
];


function fmt_bytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}



const ModelsTab: React.FC = () => {
  useLingui();
  const [catalog, setCatalog] = useState<LlmModelInfo[]>([]);
  const [modelsDir, setModelsDirState] = useState<string>("");
  const [dirInput, setDirInput] = useState<string>("");
  const [dirSaved, setDirSaved] = useState(false);
  const [activeDownloads, setActiveDownloads] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<Record<string, LlmDownloadProgress>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const nlp = ((window as unknown as { __nlp?: Record<string, unknown> }).__nlp ?? {}) as
    Record<string, boolean> & { ocrEngine?: string };
  const ocrLabel = nlp.ocrEngine === "tesseract" ? "Tesseract" : "Apple Vision";

  useEffect(() => {
    const isConnected = typeof window.saucer?.call === "function";
    if (!isConnected) return;

    models.list().then(setCatalog).catch(() => {});
    models.getModelsDir().then((dir: string) => { setModelsDirState(dir); setDirInput(dir); }).catch(() => {});
  }, []);

  const pollProgress = useCallback(async () => {
    for (const [modelId, downloadId] of Object.entries(activeDownloads)) {
      try {
        const p = await models.progress(downloadId);
        setProgress((prev) => ({ ...prev, [modelId]: p }));
        if (p.status === "completed" || p.status === "failed" || p.status === "cancelled") {
          setActiveDownloads((prev) => { const c = { ...prev }; delete c[modelId]; return c; });
          models.list().then(setCatalog).catch(() => {});
        }
      } catch { /* ignore */ }
    }
  }, [activeDownloads]);

  useEffect(() => {
    if (Object.keys(activeDownloads).length > 0) {
      pollRef.current = setInterval(pollProgress, 600);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeDownloads, pollProgress]);

  const handleDownload = async (modelId: string) => {
    try {
      const result = await models.start(modelId);
      if (!result.startsWith("error:")) setActiveDownloads((prev) => ({ ...prev, [modelId]: result }));
    } catch { /* ignore */ }
  };
  const handleCancel = async (modelId: string) => {
    const dlId = activeDownloads[modelId];
    if (!dlId) return;
    await models.cancel(dlId).catch(() => {});
    setActiveDownloads((prev) => { const c = { ...prev }; delete c[modelId]; return c; });
  };
  const handleDelete = async (modelId: string) => {
    await models.remove(modelId).catch(() => {});
    models.list().then(setCatalog).catch(() => {});
  };
  const handlePickDir = async () => {
    const res = await dms.selectDirectory();
    if (res.ok && res.data) setDirInput(res.data);
  };
  const handleSaveDir = async () => {
    if (!dirInput.trim()) return;
    await models.setModelsDir(dirInput.trim()).catch(() => {});
    setModelsDirState(dirInput.trim());
    setDirSaved(true);
    setTimeout(() => setDirSaved(false), 2500);
  };

  return (
    <div className="p-3 flex flex-col gap-5">

      <section>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] mb-1">
          {i18n._({ id: "NLP Engine — ONNX Models", message: "NLP Engine — ONNX Models" })}
        </h3>
        <p className="text-[9px] text-[var(--theme-text-muted)] leading-relaxed mb-2">
          Managed by <code className="font-mono">scripts/download_models.py</code> — placed in&nbsp;
          <code className="font-mono">data/models/</code>.
        </p>
        <div className="flex flex-col gap-1">
          {NLP_FEATURES.map(({ label, key, model, size }) => {
            const active = !!nlp[key];
            const displayModel = key === "hasOcr" ? ocrLabel : model;
            return (
              <div key={key} className="flex items-center gap-2 py-1 border-b border-[var(--theme-border)] last:border-0">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? "bg-emerald-400" : "bg-[var(--theme-border)]"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold text-[var(--theme-text)] truncate">{label}</p>
                  <p className="text-[9px] text-[var(--theme-text-muted)] font-mono truncate">{displayModel}</p>
                </div>
                <span className={`text-[9px] font-bold shrink-0 ${active ? "text-emerald-400" : "text-[var(--theme-text-muted)]"}`}>
                  {active ? i18n._({ id: "loaded", message: "loaded" }) : size}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] mb-1">
          {i18n._({ id: "LLM Model Storage", message: "LLM Model Storage" })}
        </h3>
        <p className="text-[9px] text-[var(--theme-text-muted)] leading-relaxed mb-2">
          {i18n._({ id: "Where GGUF model files are stored. Changes take effect on next launch.", message: "Where GGUF model files are stored. Changes take effect on next launch." })}
        </p>
        <div className="flex gap-1.5 items-stretch">
          <input
            type="text" value={dirInput} onChange={(e) => setDirInput(e.target.value)}
            placeholder={modelsDir || i18n._({ id: "e.g. ~/Library/Application Support/Syngrafo/models", message: "e.g. ~/Library/Application Support/Syngrafo/models" })}
            className="flex-1 text-[10px] font-mono px-2 py-1.5 min-w-0 focus:outline-none"
            style={{ background: "var(--theme-bg)", color: "var(--theme-text)", border: "1px solid var(--theme-border)", borderRadius: "var(--theme-radius-sm, 4px)" }}
          />
          <button onClick={handlePickDir} title={i18n._({ id: "Browse…", message: "Browse…" })}
            className="shrink-0 px-2 py-1 text-[10px] font-bold border border-[var(--theme-border)] hover:bg-[var(--theme-bg)] transition-colors"
            style={{ borderRadius: "var(--theme-radius-sm, 4px)", color: "var(--theme-text-muted)" }}>
            <Icon name="folder-open" size="xs" />
          </button>
          <button onClick={handleSaveDir} disabled={!dirInput.trim() || dirInput === modelsDir}
            className="shrink-0 px-2.5 py-1 text-[10px] font-bold bg-[var(--theme-primary)]/80 text-[var(--theme-bg)] disabled:opacity-40 hover:opacity-90 transition-all"
            style={{ borderRadius: "var(--theme-radius-sm, 4px)" }}>
            {dirSaved ? "✓" : i18n._({ id: "Save", message: "Save" })}
          </button>
        </div>
        {dirSaved && <p className="text-[9px] text-amber-400 mt-1">{i18n._({ id: "⚠ Restart required for the new path to take effect.", message: "⚠ Restart required for the new path to take effect." })}</p>}
      </section>

      <section>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] mb-1">
          {i18n._({ id: "LLM Catalog", message: "LLM Catalog" })}
        </h3>
        <p className="text-[9px] text-[var(--theme-text-muted)] leading-relaxed mb-2">
          GGUF models downloaded on demand via libcurl.
          Edit <code className="font-mono">data/llm_catalog.json</code> to add models.
        </p>
        {catalog.length === 0 ? (
          <p className="text-[10px] text-[var(--theme-text-muted)] italic">
            {typeof window.saucer?.call === "function"
              ? "No models in catalog — check data/llm_catalog.json."
              : i18n._({ id: "Not connected to native host.", message: "Not connected to native host." })}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {catalog.map((m) => {
              const dl = activeDownloads[m.id];
              const prog = progress[m.id];
              const isDownloading = !!dl;
              const pct = prog && prog.total_bytes > 0 ? Math.round((prog.bytes_downloaded / prog.total_bytes) * 100) : null;
              return (
                <div key={m.id} className="rounded-lg border border-[var(--theme-border)] p-2.5 flex flex-col gap-1.5" style={{ background: "var(--theme-bg)" }}>
                  <div className="flex items-start gap-2">
                    <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${m.downloaded ? "bg-emerald-400" : isDownloading ? "bg-amber-400 animate-pulse" : "bg-[var(--theme-border)]"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold text-[var(--theme-text)] truncate">{m.name}</p>
                      <p className="text-[9px] text-[var(--theme-text-muted)] leading-snug mt-0.5">{m.description}</p>
                      <p className="text-[9px] font-mono text-[var(--theme-text-muted)] mt-0.5">{fmt_bytes(m.size_bytes)} · {m.filename}</p>
                    </div>
                  </div>
                  {isDownloading && prog && (
                    <div>
                      <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: "var(--theme-border)" }}>
                        <div className="h-full bg-[var(--theme-primary)] transition-all" style={{ width: `${pct ?? 0}%` }} />
                      </div>
                      <p className="text-[9px] text-[var(--theme-text-muted)] mt-0.5 font-mono">
                        {fmt_bytes(prog.bytes_downloaded)} / {fmt_bytes(prog.total_bytes)}{pct != null ? ` · ${pct}%` : ""}
                        {prog.status === "failed" && <span className="text-red-400 ml-1">{prog.error_message}</span>}
                      </p>
                    </div>
                  )}
                  <div className="flex gap-1.5 mt-0.5">
                    {m.downloaded ? (
                      <button onClick={() => handleDelete(m.id)} className="text-[9px] font-bold px-2 py-0.5 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors">{i18n._({ id: "Delete", message: "Delete" })}</button>
                    ) : isDownloading ? (
                      <button onClick={() => handleCancel(m.id)} className="text-[9px] font-bold px-2 py-0.5 rounded border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 transition-colors">{i18n._({ id: "Cancel", message: "Cancel" })}</button>
                    ) : (
                      <button onClick={() => handleDownload(m.id)} className="text-[9px] font-bold px-2 py-0.5 rounded border border-[var(--theme-primary)]/60 text-[var(--theme-primary)] hover:bg-[var(--theme-primary)]/10 transition-colors">{i18n._({ id: "↓ Download", message: "↓ Download" })}</button>
                    )}
                    {m.downloaded && <span className="text-[9px] text-emerald-400 font-bold self-center ml-1">{i18n._({ id: "✓ Ready", message: "✓ Ready" })}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};


const ThemePanel: React.FC<ThemePanelProps> = ({ onClose }) => {
  useLingui();
  const { theme, setTheme, saveTheme, isSaving: isSavingTheme } = useTheme();
  const { settings, setSetting, saveSettings, isSaving: isSavingSettings } = useSettings();
  const { locale, setLocale } = useLocale();
  const isSaving = isSavingTheme || isSavingSettings;
  const [tab, setTab] = useState<Tab>("appearance");
  const [saveOk, setSaveOk] = useState(false);
  const [keyboardScheme, setKeyboardScheme] = useState<KeyboardScheme>(detectPreferredKeyboardScheme());

  useEffect(() => {
    dms.loadPreference(KEYBOARD_SCHEME_PREF_KEY).then(value => {
      setKeyboardScheme(normalizeKeyboardScheme(value));
    });
  }, []);

  const handleKeyboardSchemeChange = useCallback((scheme: KeyboardScheme) => {
    setKeyboardScheme(scheme);
    dms.savePreference(KEYBOARD_SCHEME_PREF_KEY, scheme);
  }, []);

  // Resolve current CSS var values for the colour pickers
  const getComputedColor = (varName: string): string => {
    // First check custom overrides, then computed style
    if (theme.customColors[varName]) return theme.customColors[varName];
    return getComputedStyle(document.documentElement)
      .getPropertyValue(varName)
      .trim();
  };

  const handleColorChange = (varName: string, value: string) => {
    setTheme({
      customColors: { ...theme.customColors, [varName]: value },
    });
  };

  const selectedPaperStyle = getResolvedPaperStyle(settings.paperStyles, settings.defaultPaperStyleId);

  const patchPaperStyle = useCallback((id: string, updater: (style: PaperStylePreset) => PaperStylePreset) => {
    setSetting({
      paperStyles: settings.paperStyles.map((style) => style.id === id ? updater(style) : style),
    });
  }, [settings.paperStyles, setSetting]);

  const handleSave = async () => {
    await Promise.all([saveTheme(), saveSettings()]);
    setSaveOk(true);
    setTimeout(() => setSaveOk(false), 2000);
  };

  // Selecting a preset clears custom colour overrides
  const handleSelectPreset = (presetId: string) => {
    setTheme({ colorPreset: presetId, customColors: {} });
  };




  const ColorsTab = () => (
    <div className="p-3 flex flex-col gap-5">

      <section>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] mb-2">
          {i18n._({ id: "Custom Colours", message: "Custom Colours" })}
        </h3>
        <p className="text-[10px] text-[var(--theme-text-muted)] leading-relaxed mb-2">
          {i18n._({ id: "Override individual colour slots. Selecting a theme preset on the Appearance tab resets all overrides.", message: "Override individual colour slots. Selecting a theme preset on the Appearance tab resets all overrides." })}
        </p>
        {COLOR_SLOTS.map(({ label, var: varName }) => {
          const current = getComputedColor(varName);
          return (
            <div key={varName} className="flex items-center gap-3 py-1">
              <div
                className="w-6 h-6 rounded-md border border-[var(--theme-border)] shrink-0"
                style={{ background: current }}
              />
              <span className="text-xs text-[var(--theme-text)] flex-1 font-medium">{label}</span>
              <span className="text-[9px] font-mono text-[var(--theme-text-muted)] w-[68px] text-right">{current}</span>
              <input
                type="color"
                value={current.startsWith("#") ? current : "#000000"}
                onChange={(e) => handleColorChange(varName, e.target.value)}
                className="w-8 h-7 rounded cursor-pointer border border-[var(--theme-border)] bg-transparent"
                title={`Set ${label}`}
              />
            </div>
          );
        })}
      </section>
    </div>
  );


  const SettingsTab = () => (
    <div className="p-3 flex flex-col gap-5">

      {/* Language */}
      <section>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] mb-1">
          {i18n._({ id: "Language", message: "Language" })}
        </h3>
        <p className="text-[9px] text-[var(--theme-text-muted)] leading-relaxed mb-3">
          {i18n._({ id: "UI language. All catalogs are pre-loaded — switching is instant.", message: "UI language. All catalogs are pre-loaded — switching is instant." })}
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {(Object.entries(LOCALES) as [SupportedLocale, string][]).map(([code, label]) => (
            <button
              key={code}
              onClick={() => setLocale(code)}
              className={`
                flex flex-col items-center justify-center py-2 px-1 rounded-lg border-2
                text-[10px] font-black uppercase tracking-wider transition-all gap-0.5
                ${locale === code
                  ? "border-[var(--theme-primary)] bg-[var(--theme-primary)]/10 text-[var(--theme-primary)]"
                  : "border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:border-[var(--theme-primary)]/50"
                }
              `}
            >
              <span className="text-[13px] font-black leading-none tracking-wider uppercase">
                {LOCALE_BADGES[code]}
              </span>
              <span>{label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Application behaviour */}
      <section>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] mb-2">
          {i18n._({ id: "Application", message: "Application" })}
        </h3>
        <div className="flex flex-col divide-y divide-[var(--theme-border)]">
          <SettingRow
            label={i18n._({ id: "Close to Systray", message: "Close to Systray" })}
            help={i18n._({ id: "Closing the window hides the app to the system tray instead of quitting. Use the tray icon or Quit menu to exit fully.", message: "Closing the window hides the app to the system tray instead of quitting. Use the tray icon or Quit menu to exit fully." })}
          >
            <Toggle
              checked={settings.closeToSystray}
              onChange={(v) => setSetting({ closeToSystray: v })}
              size="sm"
            />
          </SettingRow>
          <SettingRow
            label={i18n._({ id: "Auto-Update", message: "Auto-Update" })}
            help={i18n._({ id: "Check for updates on startup and offer to install them automatically.", message: "Check for updates on startup and offer to install them automatically." })}
          >
            <Toggle
              checked={settings.autoUpdate}
              onChange={(v) => setSetting({ autoUpdate: v })}
              size="sm"
            />
          </SettingRow>
        </div>
      </section>

      <section>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] mb-1">
          {i18n._({ id: "Paper", message: "Paper" })}
        </h3>
        <p className="text-[9px] text-[var(--theme-text-muted)] leading-relaxed mb-3">
          {i18n._({ id: "Choose the default paper appearance for new documents. Notes and markup previews reuse the same preset so editing and preview feel like the same page.", message: "Choose the default paper appearance for new documents. Notes and markup previews reuse the same preset so editing and preview feel like the same page." })}
        </p>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {settings.paperStyles.map((style) => {
            const active = style.id === settings.defaultPaperStyleId;
            return (
              <button
                key={style.id}
                onClick={() => setSetting({ defaultPaperStyleId: style.id })}
                className={`rounded-lg border p-2 text-left transition-colors ${active ? "border-[var(--theme-primary)] bg-[var(--theme-primary)]/8" : "border-[var(--theme-border)] hover:border-[var(--theme-primary)]/50"}`}
              >
                <div
                  className="h-10 rounded-md border border-[var(--theme-border)] mb-2"
                  style={{ background: paperStyleBackgroundCss(style) }}
                />
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-black uppercase tracking-wider ${active ? "text-[var(--theme-primary)]" : "text-[var(--theme-text)]"}`}>
                    {style.label}
                  </span>
                  {active && <span className="text-[8px] font-black uppercase tracking-wider text-[var(--theme-primary)] ml-auto">Default</span>}
                </div>
              </button>
            );
          })}
        </div>
        <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-[var(--theme-text-muted)]">
              {i18n._({ id: "Edit preset", message: "Edit preset" })}
            </span>
            <span className="text-[10px] font-medium text-[var(--theme-text)]">{selectedPaperStyle.label}</span>
          </div>
          <input
            type="text"
            value={selectedPaperStyle.label}
            onChange={(e) => patchPaperStyle(selectedPaperStyle.id, (style) => ({ ...style, label: e.target.value || style.label }))}
            className="w-full rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] text-[11px] px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]"
          />
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => patchPaperStyle(selectedPaperStyle.id, (style) => ({ ...style, background: { color: style.background.color ?? "#ffffff" } }))}
              className={`py-1 rounded border text-[9px] font-bold transition-colors ${selectedPaperStyle.background.gradient ? "border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:border-[var(--theme-primary)]/50" : "bg-[var(--theme-primary)] border-[var(--theme-primary)] text-[var(--theme-primary-fg)]"}`}
            >
              Solid
            </button>
            <button
              onClick={() => patchPaperStyle(selectedPaperStyle.id, (style) => ({
                ...style,
                background: style.background.gradient
                  ? style.background
                  : {
                      gradient: {
                        type: "linear",
                        angle: 180,
                        stops: [
                          { color: style.background.color ?? "#fffdf8", position: 0 },
                          { color: "#f5efe3", position: 100 },
                        ],
                      },
                    },
              }))}
              className={`py-1 rounded border text-[9px] font-bold transition-colors ${selectedPaperStyle.background.gradient ? "bg-[var(--theme-primary)] border-[var(--theme-primary)] text-[var(--theme-primary-fg)]" : "border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:border-[var(--theme-primary)]/50"}`}
            >
              Gradient
            </button>
          </div>
          {!selectedPaperStyle.background.gradient ? (
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={selectedPaperStyle.background.color?.startsWith("#") ? selectedPaperStyle.background.color : "#ffffff"}
                onChange={(e) => patchPaperStyle(selectedPaperStyle.id, (style) => ({ ...style, background: { color: e.target.value } }))}
                className="w-10 h-8 rounded cursor-pointer border border-[var(--theme-border)] bg-transparent"
              />
              <input
                type="text"
                value={selectedPaperStyle.background.color ?? ""}
                onChange={(e) => patchPaperStyle(selectedPaperStyle.id, (style) => ({ ...style, background: { color: e.target.value } }))}
                className="flex-1 rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] text-[11px] px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]"
                placeholder="#ffffff"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={selectedPaperStyle.background.gradient.stops[0]?.color?.startsWith("#") ? selectedPaperStyle.background.gradient.stops[0].color : "#fffdf8"}
                    onChange={(e) => patchPaperStyle(selectedPaperStyle.id, (style) => ({
                      ...style,
                      background: {
                        gradient: {
                          type: "linear",
                          angle: style.background.gradient?.angle ?? 180,
                          stops: [
                            { color: e.target.value, position: 0 },
                            style.background.gradient?.stops[1] ?? { color: "#f5efe3", position: 100 },
                          ],
                        },
                      },
                    }))}
                    className="w-10 h-8 rounded cursor-pointer border border-[var(--theme-border)] bg-transparent"
                  />
                  <span className="text-[10px] text-[var(--theme-text-muted)]">From</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={selectedPaperStyle.background.gradient.stops[1]?.color?.startsWith("#") ? selectedPaperStyle.background.gradient.stops[1].color : "#f5efe3"}
                    onChange={(e) => patchPaperStyle(selectedPaperStyle.id, (style) => ({
                      ...style,
                      background: {
                        gradient: {
                          type: "linear",
                          angle: style.background.gradient?.angle ?? 180,
                          stops: [
                            style.background.gradient?.stops[0] ?? { color: "#fffdf8", position: 0 },
                            { color: e.target.value, position: 100 },
                          ],
                        },
                      },
                    }))}
                    className="w-10 h-8 rounded cursor-pointer border border-[var(--theme-border)] bg-transparent"
                  />
                  <span className="text-[10px] text-[var(--theme-text-muted)]">To</span>
                </div>
              </div>
              <label className="flex items-center gap-3 text-[10px] text-[var(--theme-text-muted)]">
                <span>Angle</span>
                <input
                  type="range"
                  min={0}
                  max={360}
                  step={1}
                  value={selectedPaperStyle.background.gradient.angle}
                  onChange={(e) => patchPaperStyle(selectedPaperStyle.id, (style) => ({
                    ...style,
                    background: {
                      gradient: {
                        type: "linear",
                        angle: Number(e.target.value),
                        stops: style.background.gradient?.stops ?? [
                          { color: "#fffdf8", position: 0 },
                          { color: "#f5efe3", position: 100 },
                        ],
                      },
                    },
                  }))}
                  className="flex-1"
                />
                <span className="tabular-nums text-[var(--theme-text)]">{selectedPaperStyle.background.gradient.angle}°</span>
              </label>
            </div>
          )}
        </div>
      </section>

      {/* Keyboard & Input */}
      <section>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] mb-1">
          {i18n._({ id: "Keyboard & Input", message: "Keyboard & Input" })}
        </h3>
        <p className="text-[9px] text-[var(--theme-text-muted)] leading-relaxed mb-3">
          {i18n._({ id: "Controls how file selection, navigation and multi-select work in the file browser. Saved immediately — no restart required.", message: "Controls how file selection, navigation and multi-select work in the file browser. Saved immediately — no restart required." })}
        </p>
        <div className="flex flex-col gap-1.5">
          {INPUT_MAPPING_PRESETS.map(preset => (
            <button
              key={preset.scheme}
              onClick={() => handleKeyboardSchemeChange(preset.scheme)}
              className={`
                flex flex-col gap-0.5 p-2.5 rounded-lg border-2 text-left transition-all
                ${keyboardScheme === preset.scheme
                  ? "border-[var(--theme-primary)] bg-[var(--theme-primary)]/8"
                  : "border-[var(--theme-border)] hover:border-[var(--theme-primary)]/50"}
              `}
            >
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-black uppercase tracking-wider ${
                  keyboardScheme === preset.scheme
                    ? "text-[var(--theme-primary)]"
                    : "text-[var(--theme-text)]"
                }`}>
                  {preset.label}
                </span>
                {keyboardScheme === preset.scheme && (
                  <span className="text-[8px] font-black text-[var(--theme-primary)] ml-auto">ACTIVE</span>
                )}
              </div>
              <span className="text-[9px] text-[var(--theme-text-muted)] leading-relaxed">
                {preset.shortDescription}
              </span>
              {preset.touchDescription && (
                <span className="text-[8px] text-[var(--theme-text-muted)]/80 leading-relaxed">
                  {preset.touchDescription}
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* Display */}
      <section>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] mb-2">
          {i18n._({ id: "Display", message: "Display" })}
        </h3>
        <div className="flex flex-col divide-y divide-[var(--theme-border)]">
          <SettingRow
            label={i18n._({ id: "SVG Inline Preview Limit", message: "SVG Inline Preview Limit" })}
            help={i18n._({ id: "Maximum SVG file size rendered inline. Files above this threshold show a placeholder. Palette-based conversion produces compact output even for large source images — bump this up if your converted SVGs exceed 2 MB.", message: "Maximum SVG file size rendered inline. Files above this threshold show a placeholder. Palette-based conversion produces compact output even for large source images — bump this up if your converted SVGs exceed 2 MB." })}
          >
            <select
              value={settings.svgPreviewMaxBytes}
              onChange={(e) => setSetting({ svgPreviewMaxBytes: Number(e.target.value) })}
              className="text-[10px] font-bold px-2 py-1 focus:outline-none cursor-pointer"
              style={{
                background:   "var(--theme-bg)",
                color:        "var(--theme-text)",
                border:       "1px solid var(--theme-border)",
                borderRadius: "var(--theme-radius-sm, 4px)",
              }}
            >
              {SVG_SIZE_OPTIONS.map(({ bytes, label }) => (
                <option key={bytes} value={bytes}>{label}</option>
              ))}
            </select>
          </SettingRow>
          <SettingRow
            label={i18n._({ id: "Background Copy Threshold", message: "Background Copy Threshold" })}
            help={i18n._({ id: "Files at or above this size start as background copy/move tasks so the file browser stays responsive. 512 MB is the default sweet spot; set this to Always background if you want queued transfers for every copy.", message: "Files at or above this size start as background copy/move tasks so the file browser stays responsive. 512 MB is the default sweet spot; set this to Always background if you want queued transfers for every copy." })}
          >
            <select
              value={settings.asyncCopyThresholdBytes}
              onChange={(e) => setSetting({ asyncCopyThresholdBytes: Number(e.target.value) })}
              className="text-[10px] font-bold px-2 py-1 focus:outline-none cursor-pointer"
              style={{
                background:   "var(--theme-bg)",
                color:        "var(--theme-text)",
                border:       "1px solid var(--theme-border)",
                borderRadius: "var(--theme-radius-sm, 4px)",
              }}
            >
              {ASYNC_COPY_THRESHOLD_OPTIONS.map(({ bytes, label }) => (
                <option key={bytes} value={bytes}>{label}</option>
              ))}
            </select>
          </SettingRow>
        </div>
      </section>

    </div>
  );


  const AppearanceTab = () => (
    <div className="p-3 flex flex-col gap-5">

      {/* ── Theme Presets ─────────────────────────────────────────────────── */}
      <section>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] mb-2">
          {i18n._({ id: "Theme Presets", message: "Theme Presets" })}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {THEME_PRESETS.map((p) => (
            <PresetCard
              key={p.id}
              preset={p}
              active={theme.colorPreset === p.id}
              onSelect={() => handleSelectPreset(p.id)}
            />
          ))}
        </div>
      </section>

      <div className="h-px bg-[var(--theme-border)]" />

      <section>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] mb-2">
          {i18n._({ id: "Corner Radius", message: "Corner Radius" })}
        </h3>
        <div className="grid grid-cols-5 gap-1.5">
          {RADIUS_OPTIONS.map(({ id, label, preview }) => (
            <button
              key={id}
              onClick={() => setTheme({ radius: id })}
              className={`
                flex flex-col items-center gap-1.5 p-2 border transition-all
                ${theme.radius === id
                  ? "border-[var(--theme-primary)] bg-[var(--theme-primary)]/10 text-[var(--theme-primary)]"
                  : "border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:border-[var(--theme-primary)]/50"}
              `}
              style={{
                borderRadius: id === "none" ? "0" : id === "small" ? "4px" : id === "medium" ? "8px" : id === "large" ? "12px" : "16px",
              }}
            >
              <span
                className="w-8 h-5 border-2 border-current"
                style={{
                  borderRadius: id === "none" ? "0" : id === "small" ? "4px" : id === "medium" ? "8px" : id === "large" ? "12px" : "9999px",
                }}
              />
              <span className="text-[9px] font-bold uppercase">{label}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] mb-2">
          {i18n._({ id: "Density / Font Size", message: "Density / Font Size" })}
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {DENSITY_OPTIONS.map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => setTheme({ density: id })}
              className={`
                flex flex-col items-center gap-2 py-3 px-2 rounded-xl border-2 transition-all
                ${theme.density === id
                  ? "border-[var(--theme-primary)] bg-[var(--theme-primary)]/10 text-[var(--theme-primary)]"
                  : "border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:border-[var(--theme-primary)]/50"}
              `}
            >
              <span className={`font-mono leading-none ${id === "compact" ? "text-base" : id === "normal" ? "text-xl" : "text-2xl"}`}>
                {icon}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="h-px bg-[var(--theme-border)]" />

      <section>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] mb-2">
          {i18n._({ id: "Typography", message: "Typography" })}
        </h3>
        <div className="flex flex-col gap-1.5">
          {FONT_PAIRS.map((pair) => (
            <button
              key={pair.id}
              onClick={() => setTheme({ fontPair: pair.id })}
              className={`
                flex items-center justify-between px-3 py-2 border transition-all text-left
                ${theme.fontPair === pair.id
                  ? "border-[var(--theme-primary)] bg-[var(--theme-primary)]/10"
                  : "border-[var(--theme-border)] hover:border-[var(--theme-primary)]/50"}
              `}
              style={{ borderRadius: "var(--theme-radius)" }}
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <span
                  className={`text-sm font-semibold truncate leading-tight ${theme.fontPair === pair.id ? "text-[var(--theme-primary)]" : "text-[var(--theme-text)]"}`}
                  style={{ fontFamily: pair.sans }}
                >
                  {pair.label}
                  {pair.experimental && (
                    <span className="ml-1.5 text-[9px] font-black uppercase tracking-wider text-[var(--theme-text-muted)] opacity-60">exp</span>
                  )}
                </span>
                <span
                  className="text-[10px] text-[var(--theme-text-muted)] truncate"
                  style={{ fontFamily: pair.mono }}
                >
                  {pair.description}
                </span>
              </div>
              <div className="flex flex-col items-end gap-0.5 shrink-0 ml-3">
                <span className="text-[10px] text-[var(--theme-text-muted)] opacity-60" style={{ fontFamily: pair.sans }}>Aa</span>
                <span className="text-[9px] font-mono text-[var(--theme-text-muted)] opacity-50" style={{ fontFamily: pair.mono }}>01</span>
              </div>
            </button>
          ))}
        </div>
        {theme.density === "compact" && (
          <p className="mt-2 text-[9px] text-[var(--theme-text-muted)] opacity-60">
            {i18n._({ id: "Compact mode removes all corner rounding.", message: "Compact mode removes all corner rounding." })}
          </p>
        )}
        {theme.radius === "none" && theme.density !== "compact" && (
          <p className="mt-2 text-[9px] text-[var(--theme-text-muted)] opacity-60">
            {i18n._({ id: "Radius: None — all rounded corners are suppressed.", message: "Radius: None — all rounded corners are suppressed." })}
          </p>
        )}
      </section>

      <section>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] mb-2">
          {i18n._({ id: "Live Preview", message: "Live Preview" })}
        </h3>
        <div
          className="rounded-xl border border-[var(--theme-border)] overflow-hidden"
          style={{ borderRadius: "var(--theme-radius)" }}
        >
          <div className="flex items-center gap-2 px-3 py-2 bg-[var(--theme-surface)] border-b border-[var(--theme-border)]">
            <div className="w-2 h-2 rounded-full bg-[var(--theme-danger)]" />
            <div className="w-2 h-2 rounded-full bg-[var(--theme-primary)]" />
            <span className="text-xs font-bold text-[var(--theme-text)] ml-1">Syngrafo</span>
          </div>
          <div className="p-3 bg-[var(--theme-bg)] flex flex-col gap-1.5">
            <div className="h-2 bg-[var(--theme-text-muted)]/30 w-3/4" style={{ borderRadius: "var(--theme-radius-sm)" }} />
            <div className="h-2 bg-[var(--theme-text-muted)]/20 w-1/2" style={{ borderRadius: "var(--theme-radius-sm)" }} />
            <div className="flex gap-2 mt-1">
              <span className="text-[10px] px-2 py-0.5 font-bold text-[var(--theme-bg)] bg-[var(--theme-primary)]" style={{ borderRadius: "var(--theme-radius-sm)" }}>
                {i18n._({ id: "Primary", message: "Primary" })}
              </span>
              <span className="text-[10px] px-2 py-0.5 font-bold text-white bg-[var(--theme-danger)]" style={{ borderRadius: "var(--theme-radius-sm)" }}>
                {i18n._({ id: "Danger", message: "Danger" })}
              </span>
            </div>
            <div className="flex items-baseline gap-2 mt-1 pt-1.5 border-t border-[var(--theme-border)]">
              <span className="text-[11px] text-[var(--theme-text)]" style={{ fontFamily: "var(--theme-font-sans)" }}>
                {i18n._({ id: "The quick brown fox", message: "The quick brown fox" })}
              </span>
              <span className="text-[10px] text-[var(--theme-text-muted)]" style={{ fontFamily: "var(--theme-font-mono)" }}>
                const x = 42;
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );


  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-start justify-end"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div
        className="relative z-10 flex flex-col h-full w-[320px] bg-[var(--theme-surface)] border-l border-[var(--theme-border)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--theme-border)] shrink-0">
          <div>
            <h2 className="text-sm font-black text-[var(--theme-text)] uppercase tracking-widest">{i18n._({ id: "Theme & Settings", message: "Theme & Settings" })}</h2>
                <p className="text-[10px] text-[var(--theme-text-muted)] mt-0.5">{i18n._({ id: "Theme · Radius · Density · Colour Overrides · Config · Models", message: "Theme · Radius · Density · Colour Overrides · Config · Models" })}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors"
          >
            <Icon name="close" size="xs" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--theme-border)] shrink-0">
          {(["appearance", "colors", "settings", "models"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`
                flex-1 py-2 text-[10px] font-black uppercase tracking-widest transition-colors
                ${tab === t
                  ? "text-[var(--theme-primary)] border-b-2 border-[var(--theme-primary)] -mb-px"
                  : "text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"}
              `}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {tab === "appearance" && <AppearanceTab />}
          {tab === "colors"     && <ColorsTab />}
          {tab === "settings"   && <SettingsTab />}
          {tab === "models"     && <ModelsTab />}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-4 py-3 border-t border-[var(--theme-border)] flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[var(--theme-primary)] text-[var(--theme-bg)] text-xs font-black uppercase tracking-wider hover:opacity-90 disabled:opacity-50 transition-all"
          >
            {isSaving ? (
              <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : saveOk ? (
              <>{i18n._({ id: "✓ Saved", message: "✓ Saved" })}</>
            ) : (
              <>
                <Icon name="download" size="xs" />
                {i18n._({ id: "Save to DB", message: "Save to DB" })}
              </>
            )}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-[var(--theme-border)] text-xs font-bold uppercase tracking-wider text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-bg)] transition-colors"
          >
            {i18n._({ id: "Close", message: "Close" })}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ThemePanel;
