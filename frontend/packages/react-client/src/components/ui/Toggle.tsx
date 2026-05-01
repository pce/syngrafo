import React from "react";

interface ToggleProps {
  label?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
}

/**
 * A reusable, theme-aware Toggle switch component.
 * Respects CSS variables for background, primary, and surface colors.
 */
const Toggle: React.FC<ToggleProps> = ({
  label,
  checked,
  onChange,
  disabled = false,
  size = "md",
}) => {
  const isSm = size === "sm";

  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`
        relative flex items-center justify-between gap-3 group transition-opacity
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
        ${label ? "w-full" : "w-fit"}
      `}
    >
      {label && (
        <span
          className="text-[10px] font-bold"
          style={{ color: "var(--theme-text)" }}
        >
          {label}
        </span>
      )}
      <div
        className={`
          relative rounded-full transition-colors duration-200 ease-in-out
          ${isSm ? "w-7 h-4" : "w-8 h-4.5"}
        `}
        style={{
          backgroundColor: checked
            ? "var(--theme-primary)"
            : "var(--theme-border)",
        }}
      >
        <div
          className={`
            absolute top-0.5 bg-white rounded-full transition-all duration-200 shadow-sm
            ${isSm ? "w-3 h-3" : "w-3.5 h-3.5"}
            ${checked ? (isSm ? "left-3.5" : "left-4") : "left-0.5"}
          `}
        />
      </div>
    </button>
  );
};

export default Toggle;
