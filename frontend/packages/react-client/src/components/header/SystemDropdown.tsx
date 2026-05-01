import React from "react";
import Icon from "../Icon";
import Dropdown from "../ui/Dropdown";

interface SystemDropdownProps {
  theme: string;
  setTheme: (theme: string) => void;
  availableThemes: Array<{ name: string; label: string }>;
}

/**
 * SystemDropdown Component
 * Handles system-wide settings like theme selection.
 * Styled using theme variables for brand consistency.
 */
const SystemDropdown: React.FC<SystemDropdownProps> = ({
  theme,
  setTheme,
  availableThemes,
}) => {
  return (
    <Dropdown
      label="System"
      subLabel="Settings"
      icon="settings"
      variant="ghost"
    >
      <div
        className="px-4 pb-2 mb-2 border-b"
        style={{ borderBottomColor: "var(--theme-border)" }}
      >
        <span
          className="text-[9px] font-black uppercase tracking-widest"
          style={{ color: "var(--theme-text-muted)" }}
        >
          Theme
        </span>
      </div>
      <div className="px-2 space-y-1">
        {availableThemes.map((t) => (
          <button
            key={t.name}
            onClick={() => setTheme(t.name)}
            className={`w-full text-left px-3 py-1.5 rounded-lg text-[10px] font-bold flex items-center justify-between transition-all ${
              theme === t.name ? "" : "hover:bg-slate-500/10"
            }`}
            style={{
              backgroundColor:
                theme === t.name ? "var(--theme-primary)" : "transparent",
              color: theme === t.name ? "#fff" : "var(--theme-text)",
            }}
          >
            {t.label}
            {theme === t.name && <Icon name="plus" size="xs" />}
          </button>
        ))}
      </div>
    </Dropdown>
  );
};

export default SystemDropdown;
