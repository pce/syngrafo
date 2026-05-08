import type { SpringConfig } from '../types/physics.ts';

/**
 * Single step of a damped harmonic oscillator (semi-implicit Euler).
 *
 * Equivalent C++ (backend must use the same formula):
 *   double a = (-k * (x - target) - c * v) / m;
 *   double v_new = v + a * dt;
 *   double x_new = x + v_new * dt;   // semi-implicit: uses v_new
 *
 * @param position  current position
 * @param velocity  current velocity
 * @param target    rest position
 * @param config    spring parameters
 * @param dt        time step in seconds (typically 1/60)
 * @returns         [newPosition, newVelocity]
 */
export function stepSpring(
  position: number,
  velocity: number,
  target: number,
  config: SpringConfig,
  dt: number,
): [position: number, velocity: number] {
  const { stiffness: k, damping: c, mass: m } = config;
  const acceleration = (-k * (position - target) - c * velocity) / m;
  const newVelocity  = velocity + acceleration * dt;
  const newPosition  = position + newVelocity * dt;  // semi-implicit
  return [newPosition, newVelocity];
}

/**
 * Simulate a spring from `from` to `to` and return the full position curve
 * sampled at `fps` frames per second, up to `maxSeconds` or until settled.
 *
 * Useful for pre-computing animation curves for offline rendering.
 */
export function simulateSpring(
  from: number,
  to: number,
  config: SpringConfig,
  fps = 60,
  maxSeconds = 10,
): number[] {
  const dt = 1 / fps;
  const frames: number[] = [];
  let pos = from, vel = 0;
  const maxFrames = Math.ceil(maxSeconds * fps);
  for (let i = 0; i < maxFrames; i++) {
    [pos, vel] = stepSpring(pos, vel, to, config, dt);
    frames.push(pos);
    if (Math.abs(pos - to) < config.precision && Math.abs(vel) < config.precision) break;
  }
  return frames;
}

/** Returns true if the spring has settled within precision threshold. */
export function isSettled(
  position: number,
  velocity: number,
  target: number,
  config: SpringConfig,
): boolean {
  return Math.abs(position - target) < config.precision &&
         Math.abs(velocity) < config.precision;
}
