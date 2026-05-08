/** Spring configuration — identical parameter names as the C++ backend's spring_step(). */
export interface SpringConfig {
  stiffness: number;   // k  — spring constant     (preset: gentle=120, default=170, snappy=300)
  damping:   number;   // c  — damping coefficient  (preset: gentle=14,  default=26,  snappy=40)
  mass:      number;   // m  — mass                 (default 1.0)
  precision: number;   // convergence threshold     (default 0.001)
}

export const SPRING_PRESETS = {
  gentle:  { stiffness: 120, damping: 14, mass: 1, precision: 0.001 },
  default: { stiffness: 170, damping: 26, mass: 1, precision: 0.001 },
  snappy:  { stiffness: 300, damping: 40, mass: 1, precision: 0.001 },
  wobbly:  { stiffness: 180, damping: 12, mass: 1, precision: 0.001 },
} satisfies Record<string, SpringConfig>;

export type EasingType =
  | 'linear'
  | 'easeIn'      | 'easeOut'      | 'easeInOut'
  | 'easeInCubic' | 'easeOutCubic' | 'easeInOutCubic'
  | 'easeInQuart' | 'easeOutQuart' | 'easeInOutQuart'
  | 'spring';     // uses SpringConfig to simulate easing curve
