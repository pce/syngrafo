import type { EasingType, SpringConfig } from '../types/physics.ts';
import { SPRING_PRESETS } from '../types/physics.ts';
import { simulateSpring } from './spring.ts';

/** All easing functions map t ∈ [0,1] → value ∈ [0,1] */
export type EasingFn = (t: number) => number;

export const easings: Record<EasingType, EasingFn> = {
  linear:          t => t,
  easeIn:          t => t * t,
  easeOut:         t => 1 - (1 - t) ** 2,
  easeInOut:       t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2,
  easeInCubic:     t => t * t * t,
  easeOutCubic:    t => 1 - (1 - t) ** 3,
  easeInOutCubic:  t => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2,
  easeInQuart:     t => t ** 4,
  easeOutQuart:    t => 1 - (1 - t) ** 4,
  easeInOutQuart:  t => t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2,
  spring:          t => {
    // Lazily compute a default-spring curve and sample it at t
    const curve = simulateSpring(0, 1, SPRING_PRESETS.default, 60, 5);
    const idx = Math.min(Math.floor(t * curve.length), curve.length - 1);
    return curve[idx] ?? 1;
  },
};

/** Apply an easing to linearly interpolate between `a` and `b` at time `t`. */
export function ease(a: number, b: number, t: number, type: EasingType): number {
  return a + (b - a) * easings[type](Math.max(0, Math.min(1, t)));
}

/**
 * Build a spring easing function with a custom SpringConfig.
 * Returns values that may overshoot 1.0 (spring bounce) — intentional.
 */
export function makeSpringEasing(config: SpringConfig, fps = 60): EasingFn {
  const curve = simulateSpring(0, 1, config, fps, 10);
  return (t: number) => {
    const idx = Math.min(Math.floor(t * curve.length), curve.length - 1);
    return curve[idx] ?? 1;
  };
}
