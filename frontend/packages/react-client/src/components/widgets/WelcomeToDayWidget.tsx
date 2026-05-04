import React, { useState, useEffect } from "react";
import Icon from "../Icon";
import type { IconName } from "../Icon";

const IC = (n: string) => n as IconName;

const DAYS = [
  "Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday",
] as const;
const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
] as const;

function fmtDate(d: Date): string {
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function fmtTime(d: Date): string {
  const h    = d.getHours();
  const m    = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${m} ${ampm}`;
}

function greeting(d: Date): string {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export interface WelcomeToDayProps {
  zoneName: string;
}

/**
 * WelcomeToDayWidget — greeting clock with zone name badge.
 *
 * Special style: accent-tinted border, no header bar — the primary content
 * fills the card directly (matching the old static HTML).
 *
 * The 30-second clock interval is the only side-effect; all context data
 * (zoneName) flows in as immutable props — consistent with the
 * "widget = pure function over query state" model.
 */
const WelcomeToDayWidget: React.FC<WelcomeToDayProps> = ({ zoneName }) => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      className="rounded-2xl border bg-[var(--theme-surface)] overflow-hidden flex flex-col"
      style={{ borderColor: "var(--theme-primary)40" }}
    >
      <div className="flex-1 p-4">
        <div className="flex flex-col gap-1">
          <p className="text-[11px] font-bold text-[var(--theme-text-muted)] uppercase tracking-widest">
            {greeting(now)}
          </p>
          <p className="text-2xl font-black text-[var(--theme-text)] leading-tight tracking-tight">
            {fmtTime(now)}
          </p>
          <p className="text-xs text-[var(--theme-text-muted)]">{fmtDate(now)}</p>
          {zoneName && (
            <span
              className="mt-2 inline-flex items-center gap-1.5 self-start px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider"
              style={{ background: "var(--theme-primary)", color: "var(--theme-primary-fg)" }}
            >
              <Icon name={IC("map-pin")} size="xs" />
              {zoneName}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default WelcomeToDayWidget;
