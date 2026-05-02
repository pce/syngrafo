/**
 * ThemePanel.tsx — Slide-over panel for customising the app theme.
 *
 * Tabs:
 *  • Presets   — grid of built-in colour themes
 *  • Colors    — colour pickers for each slot
 *  • Appearance — radius + density pickers
 */

import React, { useState } from "react";
import { useTheme, THEME_PRESETS } from "../store/theme-store";
import type { ThemePreset } from "../store/theme-store";
import { useSettings } from "../store/settings-store";
import { useLocale } from "../store/locale-store";
import { LOCALES, type SupportedLocale } from "../i18n";
import Icon from "./Icon";

// ── helpers ───────────────────────────────────────────────────────────────────

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

// ── subcomponents ─────────────────────────────────────────────────────────────

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
    {/* Colour row */}
    <div className="flex gap-1">
      {[preset.surface, preset.text, preset.primary, preset.danger].map((c, i) => (
        <span key={i} className="flex-1 h-2 rounded-full" style={{ background: c }} />
      ))}
    </div>
    {/* Name */}
    <span
      className="text-[10px] font-bold uppercase tracking-wider truncate"
      style={{ color: preset.text }}
    >
      {preset.name}
    </span>
    {/* Active tick */}
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

type Tab = "presets" | "colors" | "appearance" | "settings";


const SVG_SIZE_OPTIONS: Array<{ bytes: number; label: string }> = [
  { bytes: 512_000,     label: "500 KB" },
  { bytes: 1_048_576,   label: "1 MB"   },
  { bytes: 2_097_152,   label: "2 MB"   },
  { bytes: 4_194_304,   label: "4 MB"   },
  { bytes: 8_388_608,   label: "8 MB"   },
  { bytes: 10_485_760,  label: "10 MB"  },
];

const ThemePanel: React.FC<ThemePanelProps> = ({ onClose }) => {
  const { theme, setTheme, saveTheme, isSaving: isSavingTheme } = useTheme();
  const { settings, setSetting, saveSettings, isSaving: isSavingSettings } = useSettings();
  const { locale, setLocale } = useLocale();
  const isSaving = isSavingTheme || isSavingSettings;
  const [tab, setTab] = useState<Tab>("presets");
  const [saveOk, setSaveOk] = useState(false);

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

  const handleSave = async () => {
    await Promise.all([saveTheme(), saveSettings()]);
    setSaveOk(true);
    setTimeout(() => setSaveOk(false), 2000);
  };

  // Selecting a preset clears custom colour overrides
  const handleSelectPreset = (presetId: string) => {
    setTheme({ colorPreset: presetId, customColors: {} });
  };

  // ── Tab: Presets ──────────────────────────────────────────────────────────

  const PresetsTab = () => (
    <div className="grid grid-cols-2 gap-2 p-3">
      {THEME_PRESETS.map((p) => (
        <PresetCard
          key={p.id}
          preset={p}
          active={theme.colorPreset === p.id}
          onSelect={() => handleSelectPreset(p.id)}
        />
      ))}
    </div>
  );

  // ── Tab: Colors ───────────────────────────────────────────────────────────

  const ColorsTab = () => (
    <div className="p-3 flex flex-col gap-2">
      <p className="text-[10px] text-[var(--theme-text-muted)] leading-relaxed mb-1">
        Override individual colour slots. Selecting a preset in the Presets tab resets all overrides.
      </p>
      {COLOR_SLOTS.map(({ label, var: varName }) => {
        const current = getComputedColor(varName);
        return (
          <div key={varName} className="flex items-center gap-3">
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
    </div>
  );

  // ── Tab: Settings ─────────────────────────────────────────────────────────

  const SettingsTab = () => (
    <div className="p-3 flex flex-col gap-5">

      {/* Language */}
      <section>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] mb-1">
          Language
        </h3>
        <p className="text-[9px] text-[var(--theme-text-muted)] leading-relaxed mb-3">
          UI language. All catalogs are pre-loaded — switching is instant.
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
                {code.toUpperCase()}
              </span>
              <span>{label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* SVG inline preview size */}
      <section>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] mb-1">
          SVG Inline Preview Limit
        </h3>
        <p className="text-[9px] text-[var(--theme-text-muted)] leading-relaxed mb-3">
          Maximum SVG file size rendered inline. Files above this threshold show a
          placeholder. Palette-based conversion produces compact output even for large
          source images — bump this up if your converted SVGs exceed 2 MB.
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {SVG_SIZE_OPTIONS.map(({ bytes, label }) => (
            <button
              key={bytes}
              onClick={() => setSetting({ svgPreviewMaxBytes: bytes })}
              className={`
                flex items-center justify-center py-2 px-1 rounded-lg border-2 text-[10px] font-black
                uppercase tracking-wider transition-all
                ${
                  settings.svgPreviewMaxBytes === bytes
                    ? "border-[var(--theme-primary)] bg-[var(--theme-primary)]/10 text-[var(--theme-primary)]"
                    : "border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:border-[var(--theme-primary)]/50"
                }
              `}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[9px] text-[var(--theme-text-muted)] mt-2 text-center">
          Current limit: <span className="font-bold text-[var(--theme-text)]">
            {SVG_SIZE_OPTIONS.find(o => o.bytes === settings.svgPreviewMaxBytes)?.label
              ?? `${(settings.svgPreviewMaxBytes / 1_048_576).toFixed(1)} MB`}
          </span>
        </p>
      </section>

    </div>
  );

  // ── Tab: Appearance ───────────────────────────────────────────────────────

  const AppearanceTab = () => (
    <div className="p-3 flex flex-col gap-5">

      {/* Radius */}
      <section>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] mb-2">
          Corner Radius
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

      {/* Density */}
      <section>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] mb-2">
          Density / Font Size
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

      {/* Preview swatch */}
      <section>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] mb-2">
          Live Preview
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
            <div className="h-2 rounded-full bg-[var(--theme-text-muted)]/30 w-3/4" style={{ borderRadius: "var(--theme-radius-sm)" }} />
            <div className="h-2 rounded-full bg-[var(--theme-text-muted)]/20 w-1/2" style={{ borderRadius: "var(--theme-radius-sm)" }} />
            <div className="flex gap-2 mt-1">
              <span className="text-[10px] px-2 py-0.5 font-bold text-[var(--theme-bg)] bg-[var(--theme-primary)]" style={{ borderRadius: "var(--theme-radius-sm)" }}>
                Primary
              </span>
              <span className="text-[10px] px-2 py-0.5 font-bold text-white bg-[var(--theme-danger)]" style={{ borderRadius: "var(--theme-radius-sm)" }}>
                Danger
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

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
            <h2 className="text-sm font-black text-[var(--theme-text)] uppercase tracking-widest">Theme & Settings</h2>
              <p className="text-[10px] text-[var(--theme-text-muted)] mt-0.5">Colours · Radius · Density · Config</p>
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
          {(["presets", "colors", "appearance", "settings"] as Tab[]).map((t) => (
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
          {tab === "presets"    && <PresetsTab />}
          {tab === "colors"     && <ColorsTab />}
          {tab === "appearance" && <AppearanceTab />}
          {tab === "settings"   && <SettingsTab />}
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
              <>✓ Saved</>
            ) : (
              <>
                <Icon name="download" size="xs" />
                Save to DB
              </>
            )}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-[var(--theme-border)] text-xs font-bold uppercase tracking-wider text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-bg)] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ThemePanel;
