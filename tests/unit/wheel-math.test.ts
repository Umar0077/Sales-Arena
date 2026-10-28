import { describe, it, expect } from "vitest";
import {
  planSpin,
  rotationAt,
  speedAt,
  phaseAt,
  landedSegment,
  normalizeRotation,
  segmentSize,
  TAU,
} from "@/features/spins/wheel-math";

describe("Wheel Mathematics & Physics Timeline", () => {
  it("calculates segment sizes correctly", () => {
    expect(segmentSize(8)).toBeCloseTo(Math.PI / 4);
    expect(segmentSize(6)).toBeCloseTo(Math.PI / 3);
    expect(segmentSize(12)).toBeCloseTo(Math.PI / 6);
  });

  it("determines correct landed segment for known angles", () => {
    const count = 8;
    const seg = segmentSize(count);

    // Center of segment 0 is at seg / 2
    expect(landedSegment(seg / 2, count)).toBe(0);
    // Center of segment 1 is at seg + seg / 2
    expect(landedSegment(seg * 1.5, count)).toBe(1);
    // Center of segment 7
    expect(landedSegment(seg * 7.5, count)).toBe(7);
  });

  it("plans a deterministic spin that lands on the target segment", () => {
    const count = 8;
    const targetIndex = 3;
    const startRot = 0;

    const plan = planSpin(startRot, targetIndex, count, 0);

    expect(plan.targetIndex).toBe(targetIndex);
    expect(plan.distance).toBeGreaterThan(TAU * 3); // At least 3 full revolutions

    // Final angle should land precisely on targetIndex
    const finalRot = rotationAt(plan, plan.duration);
    expect(landedSegment(finalRot, count)).toBe(targetIndex);
  });

  it("produces realistic velocity acceleration and deceleration phases", () => {
    const plan = planSpin(0, 2, 8, 0);

    // Initial speed should be 0
    expect(speedAt(plan, 0)).toBe(0);

    // Peak cruise speed
    const cruiseSpeed = speedAt(plan, plan.profile.accel + 0.1);
    expect(cruiseSpeed).toBeGreaterThan(10);

    // End speed should be 0
    expect(speedAt(plan, plan.duration)).toBe(0);

    // Phase transitions
    expect(phaseAt(plan, 0.2)).toBe("accelerating");
    expect(phaseAt(plan, plan.profile.accel + 0.2)).toBe("cruising");
    expect(phaseAt(plan, plan.duration - 0.5)).toBe("decelerating");
    expect(phaseAt(plan, plan.duration + 0.1)).toBe("done");
  });

  it("normalizes rotations within [0, 2PI)", () => {
    expect(normalizeRotation(TAU * 5 + 1.2)).toBeCloseTo(1.2);
    expect(normalizeRotation(-0.5)).toBeCloseTo(TAU - 0.5);
  });
});
