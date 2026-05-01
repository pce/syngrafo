import React, { useState, useRef, useEffect, type ReactNode } from "react";
import Icon, { type IconName } from "../Icon";

interface DropdownProps {
  label: string;
  subLabel?: string;
  icon?: IconName;
  variant?: "primary" | "warning" | "danger" | "ghost";
  children: ReactNode;
  align?: "left" | "right";
  width?: string;
}

/**
 * Reusable Dropdown Component
 * Handles click-outside logic, accessibility, and consistent styling.
 */
const Dropdown: React.FC<DropdownProps> = ({
  label,
  subLabel,
  icon,
  variant = "primary",
  children,
  align = "right",
  width = "w-64",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle escape key to close
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const variantStyles = {
    primary: {
      active:
        "bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 shadow-sm",
      button: "bg-indigo-600 text-white",
      text: "text-indigo-600 dark:text-indigo-400",
      themeColor: "var(--theme-primary)",
    },
    warning: {
      active:
        "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 shadow-sm",
      button: "bg-amber-500 text-white",
      text: "text-amber-600 dark:text-amber-400",
      themeColor: "var(--theme-warning)",
    },
    danger: {
      active:
        "bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800 shadow-sm",
      button: "bg-rose-600 text-white",
      text: "text-rose-600 dark:text-rose-400",
      themeColor: "var(--theme-danger)",
    },
    ghost: {
      active:
        "bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 shadow-sm",
      button: "bg-slate-500 text-white",
      text: "text-slate-700 dark:text-slate-200",
      themeColor: "var(--theme-text)",
    },
  };

  const currentStyles = variantStyles[variant];

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="true"
        aria-expanded={isOpen}
        className={`group flex items-center gap-3 px-4 py-2 rounded-xl border transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800 ${
          isOpen ? currentStyles.active : "hover:opacity-80"
        }`}
        style={{
          backgroundColor: "var(--theme-surface)",
          borderColor: isOpen
            ? currentStyles.themeColor
            : "var(--theme-border)",
          color: "var(--theme-text)",
        }}
      >
        <div className="flex flex-col items-end text-[10px] font-black uppercase tracking-widest">
          <span
            className="text-slate-400"
            style={{ color: "var(--theme-text-muted)" }}
          >
            {label}
          </span>
          <span
            className={currentStyles.text}
            style={{ color: currentStyles.themeColor }}
          >
            {subLabel}
          </span>
        </div>

        {icon && (
          <div
            className={`p-1.5 rounded-lg transition-colors ${isOpen ? "" : "opacity-70"}`}
            style={{
              backgroundColor: isOpen
                ? currentStyles.themeColor
                : "var(--theme-bg)",
              color: isOpen ? "#fff" : "var(--theme-text-muted)",
            }}
          >
            <Icon name={icon} size="sm" />
          </div>
        )}
      </button>

      {isOpen && (
        <div
          role="menu"
          className={`absolute ${align === "right" ? "right-0" : "left-0"} mt-3 ${width} rounded-2xl shadow-2xl border py-3 z-50 animate-in fade-in slide-in-from-top-4 duration-300 backdrop-blur-md`}
          style={{
            backgroundColor: "var(--theme-surface)",
            borderColor: "var(--theme-border)",
            boxShadow:
              "0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
};

export default Dropdown;
