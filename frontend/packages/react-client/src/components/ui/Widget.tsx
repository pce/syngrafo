import React from "react";

export interface WidgetProps {
  title?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Optional accent colour (bare hex or CSS var resolving to hex).
   *  Tints the border and header background; omit for the standard neutral style. */
  accent?: string;
}

/**
 * Standard widget shell — rounded surface with an optional header bar.
 *
 * When `title` is omitted the header is suppressed entirely, which is the
 * special style used by WelcomeToDayWidget (thick accent border, content only).
 */
const Widget: React.FC<WidgetProps> = ({ title, icon, children, className = "", accent }) => (
  <div
    className={`rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] overflow-hidden flex flex-col ${className}`}
    style={accent ? { borderColor: `${accent}40` } : undefined}
  >
    {title && (
      <div
        className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--theme-border)] shrink-0"
        style={accent ? { borderBottomColor: `${accent}30`, background: `${accent}08` } : undefined}
      >
        {icon && <span className="opacity-70">{icon}</span>}
        <span className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)]">
          {title}
        </span>
      </div>
    )}
    <div className="flex-1 p-4">{children}</div>
  </div>
);

export default Widget;
