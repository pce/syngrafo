import type { SPageBackground, SPageGradientStop } from "../models/sdm";

function clampStopPosition(position: number): number {
  if (!Number.isFinite(position)) return 0;
  return Math.min(100, Math.max(0, position));
}

function normaliseStops(stops: SPageGradientStop[]): SPageGradientStop[] {
  if (stops.length === 0) {
    return [
      { color: "#ffffff", position: 0 },
      { color: "#f3f4f6", position: 100 },
    ];
  }
  return [...stops]
    .map((stop) => ({
      color: stop.color || "#ffffff",
      position: clampStopPosition(stop.position),
    }))
    .sort((a, b) => a.position - b.position);
}

export function resolvePageBackgroundCss(background?: SPageBackground): string {
  if (!background) return "#ffffff";
  if (background.gradient?.type === "linear") {
    const stops = normaliseStops(background.gradient.stops);
    const angle = Number.isFinite(background.gradient.angle) ? background.gradient.angle : 135;
    return `linear-gradient(${angle}deg, ${stops.map((stop) => `${stop.color} ${stop.position}%`).join(", ")})`;
  }
  return background.color || "#ffffff";
}
