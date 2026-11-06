/**
 * Pure wheel mathematics. Kept free of React/Three so it can be unit tested.
 *
 * Conventions
 * - Segment `i` occupies the local clockwise angle range [i·s, (i+1)·s] measured
 *   from the top of the wheel (s = 2π / n).
 * - The wheel's rotation `φ` is a Three.js `rotation.z` value (counter-clockwise positive).
 *   A clockwise spin therefore *decreases* φ.
 * - The pointer is fixed at the top. The local angle under the pointer is `φ mod 2π`.
 */

export const TAU = Math.PI * 2;

export function mod(value: number, m: number): number {
  return ((value % m) + m) % m;
}

export function segmentSize(count: number): number {
  return TAU / count;
}

/** Index of the segment currently under the pointer. */
export function landedSegment(rotation: number, count: number): number {
  const s = segmentSize(count);
  // Small epsilon guards against floating-point boundary flicker.
  return Math.floor(mod(rotation + 1e-9, TAU) / s) % count;
}

export interface SpinProfile {
  /** Acceleration duration (s). */
  accel: number;
  /** Constant-speed cruise duration (s). */
  cruise: number;
  /** Deceleration duration (s). */
  decel: number;
  /** Deceleration curve exponent (velocity ∝ (1-u)^p). Higher = longer tail. */
  power: number;
  /** Target peak angular speed (rad/s) used to choose the number of turns. */
  targetSpeed: number;
  minTurns: number;
}

export const DEFAULT_PROFILE: SpinProfile = {
  accel: 1.0,
  cruise: 1.4,
  decel: 4.6,
  power: 3,
  targetSpeed: 22,
  minTurns: 4,
};

export function scaleProfile(profile: SpinProfile, scale: number): SpinProfile {
  const k = Math.max(0.1, scale);
  return { ...profile, accel: profile.accel * k, cruise: profile.cruise * k, decel: profile.decel * k };
}

export interface SpinPlan {
  startRotation: number;
  endRotation: number;
  /** Total clockwise travel (radians, positive). */
  distance: number;
  peakSpeed: number;
  duration: number;
  profile: SpinProfile;
  targetIndex: number;
  /** Local angle (within the wheel) that will rest under the pointer. */
  targetAngle: number;
}

/**
 * Plans a spin that starts at `startRotation` and comes to rest with the
 * centre region of segment `targetIndex` under the pointer.
 *
 * @param offset fraction of a segment in [-0.5, 0.5] to land off-centre (realism). Clamped to ±0.38.
 */
export function planSpin(
  startRotation: number,
  targetIndex: number,
  count: number,
  offset = 0,
  profile: SpinProfile = DEFAULT_PROFILE,
): SpinPlan {
  const s = segmentSize(count);
  const safeOffset = Math.max(-0.38, Math.min(0.38, offset));
  const targetAngle = targetIndex * s + s / 2 + safeOffset * s;
  const effective = 0.5 * profile.accel + profile.cruise + profile.decel / (profile.power + 1);
  const nominal = profile.targetSpeed * effective;
  const turns = Math.max(profile.minTurns, Math.round(nominal / TAU));
  const delta = mod(startRotation - targetAngle, TAU);
  const distance = turns * TAU + delta;
  const peakSpeed = distance / effective;
  return {
    startRotation,
    endRotation: startRotation - distance,
    distance,
    peakSpeed,
    duration: profile.accel + profile.cruise + profile.decel,
    profile,
    targetIndex,
    targetAngle,
  };
}

export type MotionPhase = "accelerating" | "cruising" | "decelerating" | "done";

/** Clockwise distance travelled after `t` seconds (analytical, drift-free). */
export function travelled(plan: SpinPlan, t: number): number {
  const { accel: ta, cruise: tc, decel: td, power: p } = plan.profile;
  const v = plan.peakSpeed;
  if (t <= 0) return 0;
  if (t < ta) {
    const u = t / ta;
    return v * ta * (u * u * u - (u * u * u * u) / 2);
  }
  const accelDist = v * ta * 0.5;
  if (t < ta + tc) return accelDist + v * (t - ta);
  const cruiseDist = v * tc;
  if (t < ta + tc + td) {
    const u = (t - ta - tc) / td;
    return accelDist + cruiseDist + (v * td * (1 - Math.pow(1 - u, p + 1))) / (p + 1);
  }
  return plan.distance;
}

export function rotationAt(plan: SpinPlan, t: number): number {
  if (t >= plan.duration) return plan.endRotation;
  return plan.startRotation - travelled(plan, t);
}

export function speedAt(plan: SpinPlan, t: number): number {
  const { accel: ta, cruise: tc, decel: td, power: p } = plan.profile;
  const v = plan.peakSpeed;
  if (t <= 0 || t >= plan.duration) return 0;
  if (t < ta) {
    const u = t / ta;
    return v * (3 * u * u - 2 * u * u * u);
  }
  if (t < ta + tc) return v;
  const u = (t - ta - tc) / td;
  return v * Math.pow(1 - u, p);
}

export function phaseAt(plan: SpinPlan, t: number): MotionPhase {
  const { accel: ta, cruise: tc } = plan.profile;
  if (t >= plan.duration) return "done";
  if (t < ta) return "accelerating";
  if (t < ta + tc) return "cruising";
  return "decelerating";
}

/** Reduce a rotation to [0, 2π) after a spin so values never grow unbounded. */
export function normalizeRotation(rotation: number): number {
  return mod(rotation, TAU);
}
