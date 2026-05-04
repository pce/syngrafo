

export interface NetSnapshot {
  interface_changed:  boolean;
  dns_changed:        boolean;
  route_changed:      boolean;
  local_socket_count: number;
  timestamp:          number;
}

export type NetState = "normal" | "changed" | "unusual";

export interface NetHealthStatus {
  /** Weights: interface=3, dns=2, route=2, sockets>200=1. Mirrors C++ evaluate(). */
  score:    number;
  state:    NetState;
  snapshot: NetSnapshot;
}

interface NetEnvelope {
  ok:     boolean;
  data?:  NetSnapshot;
  error?: string;
}

export const NET_MAX_SCORE = 8;

export function evaluateSnapshot(s: NetSnapshot): NetHealthStatus {
  let score = 0;
  if (s.interface_changed)        score += 3;
  if (s.dns_changed)              score += 2;
  if (s.route_changed)            score += 2;
  if (s.local_socket_count > 200) score += 1;

  const state: NetState =
    score === 0 ? "normal"  :
    score <= 3  ? "changed" :
                  "unusual";

  return { score, state, snapshot: s };
}

function netmonBinding(): ((...args: unknown[]) => Promise<string>) | undefined {
  return window.saucer?.exposed?.["netmon_health"];
}

function devSnapshot(): NetSnapshot {
  return {
    interface_changed:  false,
    dns_changed:        false,
    route_changed:      false,
    local_socket_count: Math.floor(Math.random() * 60) + 20,
    timestamp:          Date.now(),
  };
}

async function fetchEnvelope(): Promise<NetEnvelope> {
  const fn = netmonBinding();
  if (typeof fn !== "function") {
    return { ok: true, data: devSnapshot() };
  }
  try {
    const raw = await fn();
    return JSON.parse(raw) as NetEnvelope;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

type Callback = (status: NetHealthStatus | null, error: string | null) => void;

/**
 * Binds to the C++ ring buffer via `view.expose("netmon_health")`.
 * `intervalMs` is a safety-net only — the ring publishes on state change, not on schedule.
 *
 * The `pending` flag prevents tick overlap: an in-flight fetch causes the next
 * interval tick to be dropped rather than queued, keeping the UI backpressure-safe.
 */
export function subscribe(cb: Callback, intervalMs = 3000): () => void {
  let active  = true;
  let pending = false;

  const tick = async () => {
    if (!active || pending) return;
    pending = true;

    const env = await fetchEnvelope();
    if (!active) { pending = false; return; }

    if (env.ok && env.data) {
      cb(evaluateSnapshot(env.data), null);
    } else {
      cb(null, env.error ?? "Unknown error");
    }

    pending = false;
  };

  void tick();
  const id = setInterval(tick, intervalMs);

  return () => {
    active = false;
    clearInterval(id);
  };
}

export const netmon = {
  subscribe,
  evaluate: evaluateSnapshot,
  isConnected: () => typeof netmonBinding() === "function",
};
