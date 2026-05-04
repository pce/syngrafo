import React from "react";
import Icon from "../Icon";
import type { IconName } from "../Icon";
import Widget from "../ui/Widget";
import { NET_MAX_SCORE } from "../../services/netmon-service";
import type { NetState } from "../../services/netmon-service";
import type { NetHealthResult } from "../../hooks/useNetHealth";

const STATE_CFG: Record<NetState, { color: string; label: string }> = {
  normal:  { color: "var(--theme-success, #22c55e)", label: "Normal"  },
  changed: { color: "var(--theme-warning, #f59e0b)", label: "Changed" },
  unusual: { color: "var(--theme-danger,  #ef4444)", label: "Unusual" },
};

const SignalFlag: React.FC<{
  label:  string;
  icon:   IconName;
  /** When true the flag renders in warning colour. */
  active: boolean;
  /** When provided, shown as a numeric value instead of a check/warning icon. */
  value?: string;
}> = ({ label, icon, active, value }) => {
  const color = active
    ? "var(--theme-warning, #f59e0b)"
    : "var(--theme-success, #22c55e)";

  return (
    <div
      className="flex flex-col items-center gap-1 py-2 px-1 rounded-xl"
      style={{ background: active ? "#f59e0b0d" : "var(--theme-bg)" }}
    >
      <span style={{ color }} className="opacity-75">
        <Icon name={icon} size="sm" />
      </span>
      <span className="text-[8px] font-black uppercase tracking-widest text-center leading-tight text-[var(--theme-text-muted)]">
        {label}
      </span>
      {value !== undefined ? (
        <span className="text-[9px] font-black tabular-nums" style={{ color }}>
          {value}
        </span>
      ) : (
        <span style={{ color }}>
          <Icon name={active ? "warning" : "check"} size="xs" />
        </span>
      )}
    </div>
  );
};

function fmtTs(ms: number | null): string {
  if (ms === null) return "—";
  const d  = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * NetHealthWidget — pure render over NetHealthResult query state.
 *
 * No hooks, no side-effects. The parent (ZoneDashboard) owns the subscription
 * via useNetHealth() and passes the snapshot down as immutable props —
 * consistent with the "widget = pure function over query state" model.
 */
const NetHealthWidget: React.FC<NetHealthResult> = ({
  status, error, isConnected, lastUpdated,
}) => {
  const state = status?.state ?? "normal";
  const score = status?.score ?? 0;
  const snap  = status?.snapshot;
  const cfg   = STATE_CFG[state];

  return (
    <Widget
      title="Net Health"
      icon={<Icon name="shield" size="xs" />}
    >
      <div className="flex flex-col gap-3">

        {/* Status row */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)]">
              Status
            </span>
            <span className="text-sm font-black leading-tight" style={{ color: cfg.color }}>
              {cfg.label}
            </span>
            {error ? (
              <span className="text-[8px] text-[var(--theme-danger,#ef4444)] font-mono mt-0.5">
                {error}
              </span>
            ) : (
              <span className="text-[8px] font-mono mt-0.5 text-[var(--theme-text-muted)]">
                {score} / {NET_MAX_SCORE}
              </span>
            )}
          </div>
          <div
            className={`w-2 h-2 rounded-full ${isConnected ? "animate-pulse" : "opacity-30"}`}
            style={{ background: cfg.color }}
            title={isConnected ? "Native backend connected" : "Dev — simulated"}
          />
        </div>

        {/* Signal flags */}
        <div className="grid grid-cols-4 gap-1">
          <SignalFlag label="Iface"   icon="activity"    active={snap?.interface_changed ?? false} />
          <SignalFlag label="DNS"     icon="cloud"       active={snap?.dns_changed ?? false} />
          <SignalFlag label="Route"   icon="trending-up" active={snap?.route_changed ?? false} />
          <SignalFlag
            label="Sockets"
            icon="database"
            active={(snap?.local_socket_count ?? 0) > 200}
            value={snap !== undefined ? String(snap.local_socket_count) : "—"}
          />
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between pt-2 border-t"
          style={{ borderTopColor: "var(--theme-border)" }}
        >
          <div className="flex items-center gap-1 opacity-50 text-[var(--theme-text-muted)]">
            <Icon name="eye-off" size="xs" />
            <span className="text-[8px] font-bold">local only · no peer scan</span>
          </div>
          <span className="text-[8px] font-mono opacity-40 text-[var(--theme-text-muted)]">
            {fmtTs(lastUpdated)}
          </span>
        </div>

      </div>
    </Widget>
  );
};

export default NetHealthWidget;
