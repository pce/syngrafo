import { useState, useEffect } from "react";
import { netmon } from "../services/netmon-service";
import type { NetHealthStatus } from "../services/netmon-service";

export interface NetHealthResult {
  status:      NetHealthStatus | null;
  error:       string | null;
  isConnected: boolean;
  lastUpdated: number | null;
}

/**
 * `intervalMs` is the safety-net poll period, not the primary update cadence —
 * the C++ ring buffer delivers snapshots sooner when local state actually changes.
 */
export function useNetHealth(intervalMs = 3000): NetHealthResult {
  const [result, setResult] = useState<NetHealthResult>({
    status:      null,
    error:       null,
    isConnected: netmon.isConnected(),
    lastUpdated: null,
  });

  useEffect(() => {
    const connected = netmon.isConnected();

    const unsub = netmon.subscribe((status, error) => {
      setResult({ status, error, isConnected: connected, lastUpdated: Date.now() });
    }, intervalMs);

    return unsub;
  }, [intervalMs]);

  return result;
}
