import React from "react";
import { Icon } from "../Icon";
import type { IconName } from "../Icon";

export interface InlineActionRailAction {
  id: string;
  label: string;
  icon?: IconName;
  onClick: () => void;
  active?: boolean;
}

export interface InlineActionRailMetric {
  label: string;
  value: string;
}

export interface InlineActionRailProps {
  title: string;
  subtitle?: string;
  metrics?: InlineActionRailMetric[];
  actions?: InlineActionRailAction[];
  badges?: string[];
  className?: string;
  children?: React.ReactNode;
}

export function InlineActionRail({
  title,
  subtitle,
  metrics = [],
  actions = [],
  badges = [],
  className = "",
  children,
}: InlineActionRailProps): React.ReactElement {
  return (
    <div
      className={[
        "min-w-[12rem] max-w-[20rem] rounded-xl border border-[var(--theme-border)]",
        "bg-[var(--theme-surface)]/95 text-[var(--theme-text)] shadow-lg backdrop-blur-sm",
        "px-3 py-2 flex flex-col gap-2",
        className,
      ].join(" ")}
    >
      <div className="flex flex-col gap-0.5">
        <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[var(--theme-text-muted)] opacity-70">
          {title}
        </div>
        {subtitle && (
          <div className="text-[11px] font-medium leading-snug text-[var(--theme-text)]">
            {subtitle}
          </div>
        )}
      </div>

      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {badges.map((badge) => (
            <span
              key={badge}
              className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-bg)] px-1.5 py-0.5 text-[8px] font-mono text-[var(--theme-text-muted)]"
            >
              {badge}
            </span>
          ))}
        </div>
      )}

      {metrics.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          {metrics.map((metric) => (
            <div
              key={`${metric.label}-${metric.value}`}
              className="rounded-lg bg-[var(--theme-bg)] px-2 py-1"
            >
              <div className="text-[8px] uppercase tracking-wide text-[var(--theme-text-muted)] opacity-60">
                {metric.label}
              </div>
              <div className="text-[10px] font-semibold text-[var(--theme-text)]">
                {metric.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {children}

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={action.onClick}
              className={[
                "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-semibold transition-colors",
                action.active
                  ? "border-[var(--theme-primary)] bg-[var(--theme-primary)]/10 text-[var(--theme-primary)]"
                  : "border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]",
              ].join(" ")}
            >
              {action.icon && <Icon name={action.icon} size="xs" />}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
