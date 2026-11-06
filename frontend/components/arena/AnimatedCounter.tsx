"use client";

import { useEffect, useRef, useState } from "react";

export function AnimatedCounter({
  value,
  duration = 800,
  formatter = (v: number) => v.toLocaleString(),
}: {
  value: number;
  duration?: number;
  formatter?: (v: number) => string;
}) {
  const [displayValue, setDisplayValue] = useState(value);
  const startRef = useRef(value);
  const endRef = useRef(value);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    // If target value equals display value, avoid starting an animation loop
    if (value === displayValue) return;

    // Check if tab is hidden or user prefers reduced motion
    const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const isHidden = typeof document !== "undefined" && document.hidden;
    if (prefersReducedMotion || isHidden || duration <= 0) {
      const raf = requestAnimationFrame(() => setDisplayValue(value));
      return () => cancelAnimationFrame(raf);
    }

    startRef.current = displayValue;
    endRef.current = value;
    startTimeRef.current = performance.now();

    let animId: number;

    const animate = (now: number) => {
      if (!startTimeRef.current) return;
      const elapsed = now - startTimeRef.current;
      const progress = Math.min(1, elapsed / duration);
      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startRef.current + (endRef.current - startRef.current) * ease);

      setDisplayValue(current);

      if (progress < 1) {
        animId = requestAnimationFrame(animate);
      }
    };

    animId = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animId);
  }, [value, duration, displayValue]);

  return <span>{formatter(displayValue)}</span>;
}
