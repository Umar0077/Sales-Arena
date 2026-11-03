"use client";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref, type RefObject } from "react";
import { CubStage, type CubMotion } from "./CubStage";
import type { CubView } from "@/lib/cub/director";
import type { ArenaCubConfig } from "@/lib/cub/config";
import { isMove, type CubAction } from "@/lib/cub/actions";
import { bubbleSideFor, homeFor, movePlan, type Bounds, type MovePhase } from "@/lib/cub/motion";

export interface CubPlayerHandle {
  /** Seconds a move takes on this screen (the director's timer uses the same plan). */
  moveSec: (action: CubAction, id: string) => number;
}

interface Props {
  view: CubView;
  cfg: ArenaCubConfig;
  /** "viewport": fixed on the page (Live Arena). "box": inside a container (Admin preview). */
  frame: "viewport" | "box";
  boxRef?: RefObject<HTMLElement | null>;
  motion: CubMotion;
  paused?: boolean;
  particles?: boolean;
  logo?: string;
  testId?: string;
  /** Called when a move must stop early (screen resized mid-run): the cub returns home. */
  onMoveAborted?: () => void;
  handleRef?: Ref<CubPlayerHandle>;
}

type MoveState = { phase: MovePhase; dir: -1 | 1; hops: boolean; fast: boolean } | null;

function measure(frame: Props["frame"], boxRef?: RefObject<HTMLElement | null>): Bounds | null {
  if (frame === "box") {
    const el = boxRef?.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 ? { w: r.width, h: r.height, top: 0, badge: null } : null;
  }
  const header = document.querySelector("header")?.getBoundingClientRect();
  let badge: Bounds["badge"] = null;
  document.querySelectorAll('[data-testid="powered-by"]').forEach((el) => {
    const b = el.getBoundingClientRect();
    if (!badge && b.width > 0) badge = { x: b.left, y: b.top, w: b.width, h: b.height };
  });
  return { w: window.innerWidth, h: window.innerHeight, top: header ? Math.max(0, header.bottom) : 0, badge };
}

const translateX = (el: HTMLElement) => {
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 0;
  const m = t.match(/matrix\(([^)]+)\)/);
  return m ? Number(m[1].split(",")[4]) || 0 : 0;
};

/**
 * Places the cub at its home position and performs moves: a planned path (prep → run → turn → run back
 * → settle) animated with the Web Animations API (transform only), with the leg cycle in CSS. A move
 * always ends at exactly x = 0; an interrupted move runs home from wherever it is.
 */
export function CubPlayer({ view, cfg, frame, boxRef, motion, paused, particles, logo, testId = "arena-cub", onMoveAborted, handleRef }: Props) {
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [move, setMove] = useState<MoveState>(null);
  const [returning, setReturning] = useState(false);
  const moverRef = useRef<HTMLDivElement | null>(null);
  const anim = useRef<Animation | null>(null);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const running = useRef<string | null>(null);
  const boundsRef = useRef<Bounds | null>(null);
  const cfgRef = useRef(cfg);
  const abortRef = useRef(onMoveAborted);
  useLayoutEffect(() => {
    cfgRef.current = cfg;
    abortRef.current = onMoveAborted;
    boundsRef.current = bounds;
  });

  // Bounds: viewport or container, kept current on resize.
  useEffect(() => {
    const update = () => {
      const b = measure(frame, boxRef);
      setBounds((cur) => (b && cur && cur.w === b.w && cur.h === b.h && cur.top === b.top && cur.badge?.x === b.badge?.x && cur.badge?.w === b.badge?.w ? cur : b));
    };
    update();
    const late = setTimeout(update, 600); // header / badge settle after first paint
    const iv = setInterval(update, 3000);
    const onResize = () => {
      update();
      // Path no longer valid: stop the run safely and come home.
      if (running.current) abortRef.current?.();
    };
    window.addEventListener("resize", onResize);
    let ro: ResizeObserver | null = null;
    if (frame === "box" && boxRef?.current && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(onResize);
      ro.observe(boxRef.current);
    }
    return () => {
      clearTimeout(late);
      clearInterval(iv);
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
    };
  }, [frame, boxRef]);

  const home = bounds ? homeFor(cfg, bounds) : null;

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  /** Run back to x = 0 from wherever the cub is (interrupted move). */
  const goHome = useCallback(() => {
    const el = moverRef.current;
    clearTimers();
    running.current = null;
    if (!el) return setMove(null);
    const x = translateX(el);
    anim.current?.cancel();
    anim.current = null;
    if (Math.abs(x) < 2) {
      setMove(null);
      setReturning(false);
      return;
    }
    const ms = Math.min(1100, Math.max(280, Math.abs(x) / 1.1));
    setReturning(true);
    setMove({ phase: "run", dir: x > 0 ? -1 : 1, hops: false, fast: true });
    const a = el.animate([{ transform: `translateX(${x}px)` }, { transform: "translateX(0px)" }], { duration: ms, easing: "ease-in-out" });
    anim.current = a;
    a.onfinish = () => {
      if (anim.current === a) anim.current = null;
      setMove(null);
      setReturning(false);
    };
  }, []);

  // Start / stop moves when the director's command changes.
  const cmd = view.command;
  useEffect(() => {
    const el = moverRef.current;
    const b = boundsRef.current;
    if (!cmd || !isMove(cmd.action)) {
      if (running.current) goHome();
      return;
    }
    if (running.current === cmd.id || !el || !b) return;
    running.current = cmd.id;
    clearTimers();
    anim.current?.cancel();
    const h = homeFor(cfgRef.current, b);
    const plan = movePlan(cmd.action, h, b, cmd.id);
    const fast = plan.action === "dash";
    if (motion === "reduced") {
      // Reduced motion: no travel across the screen, a still "running" pose at home.
      setMove({ phase: "run", dir: plan.steps[0].dir, hops: false, fast });
      timers.current.push(setTimeout(() => setMove(null), plan.totalMs));
      return;
    }
    const frames: Keyframe[] = [{ transform: "translateX(0px)", offset: 0 }];
    let t = 0;
    for (const s of plan.steps) {
      t += s.ms;
      frames.push({ transform: `translateX(${s.x}px)`, offset: Math.min(1, t / plan.totalMs), easing: s.phase === "run" ? "cubic-bezier(0.45, 0.05, 0.55, 0.95)" : "ease-out" });
    }
    const a = el.animate(frames, { duration: plan.totalMs, fill: "none" });
    anim.current = a;
    let at = 0;
    for (const s of plan.steps) {
      const step = s;
      timers.current.push(setTimeout(() => setMove({ phase: step.phase, dir: step.dir, hops: Boolean(step.hops), fast }), at));
      at += s.ms;
    }
    timers.current.push(
      setTimeout(() => {
        running.current = null;
        setMove(null);
      }, plan.totalMs),
    );
    a.onfinish = () => {
      if (anim.current === a) anim.current = null;
    };
  }, [cmd, motion, goHome]);

  // Unmount: release everything.
  useEffect(
    () => () => {
      clearTimers();
      anim.current?.cancel();
    },
    [],
  );

  // Pause the travel with the tab (CSS pauses the limbs).
  useEffect(() => {
    if (!anim.current) return;
    if (paused) anim.current.pause();
    else if (anim.current.playState === "paused") anim.current.play();
  }, [paused]);

  useImperativeHandle(
    handleRef,
    () => ({
      moveSec: (action, id) => {
        const b = boundsRef.current;
        if (!b) return 6;
        return movePlan(action as Parameters<typeof movePlan>[0], homeFor(cfgRef.current, b), b, id).totalMs / 1000 + 0.05;
      },
    }),
    [],
  );

  if (!bounds || !home) return null;
  const bscale = Math.min(1.5, Math.max(0.85, home.charH / 240));
  const side = bubbleSideFor(home, bounds, 270 * bscale);
  const pose = returning ? "run" : view.pose;
  const greeting = pose === "greet";
  const amp = cfg.intensity === "calm" ? 0.65 : cfg.intensity === "lively" ? 1.3 : 1;

  return (
    <div
      className={frame === "viewport" ? "pointer-events-none fixed z-30" : "pointer-events-none absolute z-10"}
      style={{ left: home.left, top: home.top, width: home.boxW, height: home.boxH }}
      data-testid={`${testId}-root`}
      data-char-height={home.charH}
      data-moving={move ? "true" : undefined}
    >
      <div ref={moverRef} data-testid={`${testId}-mover`} style={{ width: "100%", height: "100%", willChange: move ? "transform" : undefined }}>
        <div
          style={{
            width: "100%",
            height: "100%",
            transformOrigin: "50% 100%",
            transform: greeting && motion !== "reduced" ? "scale(1.18)" : "none",
            transition: "transform 0.6s cubic-bezier(0.3, 1.3, 0.5, 1)",
          }}
        >
          <CubStage
            testId={testId}
            pose={pose}
            act={returning ? null : view.act}
            playKey={`${pose}-${returning ? "home" : view.playKey}`}
            size={home.boxW}
            motion={motion}
            paused={paused}
            amp={amp}
            durations={{ feed: cfg.feedingSec, bonus: cfg.bonusSec, act: Math.max(4, cfg.bubbleSec) }}
            bubble={!returning && view.bubble ? { ...view.bubble, side, compact: bounds.w < 768 } : null}
            particles={particles}
            logo={logo}
            move={pose === "run" ? (move?.phase ?? "prep") : null}
            dir={move?.dir ?? 1}
            cycle={move?.fast ? 0.28 : 0.42}
            hops={move?.hops}
            bubbleScale={bscale}
          />
        </div>
      </div>
    </div>
  );
}
