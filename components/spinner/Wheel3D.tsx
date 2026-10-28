"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import type { Reward } from "@/types";
import { type SpinPlan, rotationAt, speedAt, phaseAt, segmentSize, landedSegment, normalizeRotation, TAU } from "@/features/spins/wheel-math";
import { audioEngine } from "@/lib/audio/engine";
import { SpinRecorder } from "@/lib/performance/frame-monitor";
import { usePerfStore } from "@/lib/performance/perf-store";
import { drawWheelFace, drawGlowMask, FACE } from "./wheel-face";

export type WheelPhase = "idle" | "preparing" | "spinning" | "result";

export interface WheelLook {
  colors: string[];
  leds: [string, string];
  accent: string;
  glow: number;
  lights: boolean;
  lightSpeed: number;
  reducedMotion: boolean;
  /** Bumps when Sora finishes loading so the face is redrawn with it. */
  fontVersion: number;
}

interface Wheel3DProps {
  rewards: Reward[];
  look: WheelLook;
  activeSpinPlan: SpinPlan | null;
  currentRotationRef: React.MutableRefObject<number>;
  onSpinComplete: (landedIndex: number) => void;
  onPhaseChange?: (phase: string) => void;
  phase: WheelPhase;
  winnerIndex: number | null;
}

const R = 3; // face radius (world units)
const LED_COUNT = 24;
const MAX_SEGMENTS = 12;

const faceVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Face = base texture + neon glow layer. Each segment's glow is scaled by its own
// intensity, which is how the light chase and winner highlight work without redrawing.
const faceFragment = /* glsl */ `
  uniform sampler2D uBase;
  uniform sampler2D uGlow;
  uniform float uSeg[${MAX_SEGMENTS}];
  uniform float uSegAngle;
  uniform float uGlowStrength;
  uniform int uWinner;
  uniform float uWinPulse;
  varying vec2 vUv;
  const float TAU = 6.28318530718;
  void main() {
    vec4 base = texture2D(uBase, vUv);
    vec3 glow = texture2D(uGlow, vUv).rgb;
    vec2 p = vUv - 0.5;
    float a = mod(atan(p.x, p.y) + TAU, TAU);
    int idx = int(floor(a / uSegAngle));
    float k = 0.0;
    for (int i = 0; i < ${MAX_SEGMENTS}; i++) { if (i == idx) k = uSeg[i]; }
    vec3 col = base.rgb;
    float r = length(p) * 2.0;
    if (uWinner >= 0 && r > ${FACE.inner.toFixed(3)} && r < ${FACE.outer.toFixed(3)}) {
      if (idx == uWinner) col *= 1.0 + 0.45 * uWinPulse;
      else col *= 0.55;
    }
    col += glow * k * uGlowStrength;
    gl_FragColor = vec4(col, base.a);
    #include <colorspace_fragment>
  }
`;

function makeCanvasTexture(draw: (c: HTMLCanvasElement) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  draw(c);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Radial gradient sprite used for the soft halo behind the wheel. */
function makeHaloTexture(inner: string, outer: string): THREE.CanvasTexture {
  return makeCanvasTexture((c) => {
    c.width = c.height = 256;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 128);
    g.addColorStop(0, inner);
    g.addColorStop(0.45, outer);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  });
}

/** Brushed-steel look for the hub (conic streaks). */
function makeBrushedTexture(): THREE.CanvasTexture {
  return makeCanvasTexture((c) => {
    c.width = c.height = 512;
    const ctx = c.getContext("2d")!;
    const g = ctx.createConicGradient(0, 256, 256);
    const stops = ["#9aa3b5", "#e9eef7", "#7d8597", "#d5dbe6", "#8a92a3", "#f2f5fb", "#9aa3b5"];
    stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    ctx.globalAlpha = 0.08;
    for (let i = 0; i < 260; i++) {
      ctx.strokeStyle = Math.random() > 0.5 ? "#fff" : "#000";
      ctx.beginPath();
      ctx.arc(256, 256, Math.random() * 256, Math.random() * TAU, Math.random() * TAU);
      ctx.stroke();
    }
  });
}

/** Teardrop pointer outline: round head on top, tip pointing down at the wheel. */
function teardropShape(w: number, h: number): THREE.Shape {
  const r = w / 2;
  const s = new THREE.Shape();
  s.moveTo(0, -h / 2);
  s.bezierCurveTo(r * 0.35, -h / 2 + h * 0.28, r, -h / 2 + h * 0.42, r, h / 2 - r);
  s.absarc(0, h / 2 - r, r, 0, Math.PI, false);
  s.bezierCurveTo(-r, -h / 2 + h * 0.42, -r * 0.35, -h / 2 + h * 0.28, 0, -h / 2);
  return s;
}

export function Wheel3D({
  rewards,
  look,
  activeSpinPlan,
  currentRotationRef,
  onSpinComplete,
  onPhaseChange,
  phase,
  winnerIndex,
}: Wheel3DProps) {
  const wheelRef = useRef<THREE.Group>(null);
  const pointerRef = useRef<THREE.Group>(null);
  const gemMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const ledsRef = useRef<THREE.InstancedMesh>(null);
  const haloRef = useRef<THREE.MeshBasicMaterial>(null);
  const spinStart = useRef<number | null>(null);
  const lastPhase = useRef("idle");
  const deflection = useRef(0);
  const lastPin = useRef(-1);
  const winnerAt = useRef(0);
  const recorder = useRef(new SpinRecorder());
  const addSpinPerf = usePerfStore((s) => s.addSpin);

  // Latest callbacks/props in refs so re-renders never restart a running spin.
  const cb = useRef({ onSpinComplete, onPhaseChange, phase, winnerIndex, look });
  useEffect(() => {
    cb.current = { onSpinComplete, onPhaseChange, phase, winnerIndex, look };
  });
  useEffect(() => {
    if (winnerIndex !== null) winnerAt.current = performance.now();
  }, [winnerIndex]);

  const n = rewards.length;
  const segAngle = segmentSize(n);
  const facesKey = rewards.map((r) => `${r.id}:${r.title}:${r.icon}`).join("|") + look.colors.join(",") + look.fontVersion;

  // Face textures are rebuilt only when what is drawn changes (never during a spin).
  const { baseTex, glowTex } = useMemo(() => {
    const opts = { rewards, colors: look.colors, size: 2048 };
    return {
      baseTex: makeCanvasTexture((c) => drawWheelFace(c, opts)),
      glowTex: makeCanvasTexture((c) => drawGlowMask(c, { ...opts, size: 1024 })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facesKey]);
  useEffect(() => () => {
    baseTex.dispose();
    glowTex.dispose();
  }, [baseTex, glowTex]);

  const faceMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: faceVertex,
        fragmentShader: faceFragment,
        uniforms: {
          uBase: { value: null },
          uGlow: { value: null },
          uSeg: { value: new Array(MAX_SEGMENTS).fill(1) },
          uSegAngle: { value: 1 },
          uGlowStrength: { value: 1 },
          uWinner: { value: -1 },
          uWinPulse: { value: 0 },
        },
        transparent: true,
      }),
    [],
  );
  useEffect(() => () => faceMaterial.dispose(), [faceMaterial]);
  useEffect(() => {
    faceMaterial.uniforms.uBase.value = baseTex;
    faceMaterial.uniforms.uGlow.value = glowTex;
    faceMaterial.uniforms.uSegAngle.value = segAngle;
  }, [faceMaterial, baseTex, glowTex, segAngle]);

  const brushed = useMemo(() => makeBrushedTexture(), []);
  const halo = useMemo(() => makeHaloTexture("rgba(139,92,255,0.55)", "rgba(34,211,255,0.16)"), []);
  const logo = useMemo(() => {
    const t = new THREE.TextureLoader().load("/brand/logo-mark.webp");
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  const pointerGeom = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(teardropShape(0.62, 0.95), { depth: 0.16, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 4, curveSegments: 32 });
    g.center();
    return g;
  }, []);
  const pointerOutline = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(teardropShape(0.76, 1.1), { depth: 0.08, bevelEnabled: false, curveSegments: 32 });
    g.center();
    return g;
  }, []);
  useEffect(
    () => () => {
      brushed.dispose();
      halo.dispose();
      logo.dispose();
      pointerGeom.dispose();
      pointerOutline.dispose();
    },
    [brushed, halo, logo, pointerGeom, pointerOutline],
  );

  // LED pegs on the static rim: positions set once, colours animated per frame.
  const ledColors = useMemo(() => [new THREE.Color(look.leds[0]), new THREE.Color(look.leds[1])], [look.leds]);
  useEffect(() => {
    const mesh = ledsRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const radius = R + 0.24;
    for (let k = 0; k < LED_COUNT; k++) {
      const a = (k / LED_COUNT) * TAU;
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
      m.compose(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0.2), q, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k, ledColors[k % 2]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [ledColors]);

  // Start timing when a new plan arrives (and only then).
  useEffect(() => {
    if (!activeSpinPlan) return;
    spinStart.current = performance.now();
    lastPhase.current = "spinning";
    lastPin.current = -1;
    recorder.current.begin();
    audioEngine.startLoop();
    cb.current.onPhaseChange?.("spinning");
  }, [activeSpinPlan]);

  const tmpColor = useMemo(() => new THREE.Color(), []);

  useFrame((state, delta) => {
    const now = performance.now();
    const t = state.clock.elapsedTime;
    const { look: lk, phase: ph, winnerIndex: win } = cb.current;
    if (recorder.current.active) recorder.current.push(delta * 1000);
    deflection.current *= 0.82;

    let speedNorm = 0;
    if (activeSpinPlan && spinStart.current !== null) {
      const elapsed = (now - spinStart.current) / 1000;
      const rot = rotationAt(activeSpinPlan, elapsed);
      speedNorm = Math.min(1, speedAt(activeSpinPlan, elapsed) / activeSpinPlan.peakSpeed);
      currentRotationRef.current = rot;
      audioEngine.setLoopIntensity(speedNorm);

      // Tick whenever a segment boundary passes the pointer.
      const pin = Math.floor((((rot % TAU) + TAU) % TAU) / segAngle);
      if (pin !== lastPin.current) {
        if (lastPin.current !== -1) {
          deflection.current = Math.min(0.42, 0.14 + speedNorm * 0.28);
          audioEngine.play("tick", { rate: 0.8 + speedNorm * 0.6, volume: 0.2 + speedNorm * 0.6 });
        }
        lastPin.current = pin;
      }
      const p = phaseAt(activeSpinPlan, elapsed);
      if (p !== lastPhase.current) {
        lastPhase.current = p;
        cb.current.onPhaseChange?.(p);
      }
      if (elapsed >= activeSpinPlan.duration) {
        audioEngine.stopLoop();
        spinStart.current = null;
        currentRotationRef.current = normalizeRotation(activeSpinPlan.endRotation);
        const perf = recorder.current.end();
        addSpinPerf({ ...perf, at: new Date().toISOString(), quality: "auto", durationMs: activeSpinPlan.duration * 1000 });
        cb.current.onSpinComplete(landedSegment(currentRotationRef.current, n));
      }
    }

    if (wheelRef.current) {
      wheelRef.current.rotation.z = currentRotationRef.current;
      // Activation: a gentle "charge" pulse instead of moving the wheel off its start angle.
      const target = ph === "preparing" && !lk.reducedMotion ? 1.025 + Math.sin(t * 18) * 0.004 : 1;
      const sc = THREE.MathUtils.lerp(wheelRef.current.scale.x, target, 0.2);
      wheelRef.current.scale.setScalar(sc);
    }
    if (pointerRef.current) pointerRef.current.rotation.z = deflection.current;

    // ---- Lighting ----
    const animate = lk.lights && !lk.reducedMotion;
    const segs = faceMaterial.uniforms.uSeg.value as number[];
    const winPulse = win !== null ? 0.6 + 0.4 * Math.sin((now - winnerAt.current) / 160) : 0;
    for (let i = 0; i < MAX_SEGMENTS; i++) {
      let k: number;
      if (win !== null) k = i === win ? 1.5 + 0.5 * winPulse : 0.18;
      else if (ph === "preparing") k = 1.2 + 0.3 * Math.sin(t * 14 + i);
      else if (activeSpinPlan) k = 0.75 + 0.6 * speedNorm;
      else if (animate) {
        // A soft wave travelling clockwise around the wheel.
        const w = 0.5 + 0.5 * Math.sin(t * 1.4 * lk.lightSpeed - (i / Math.max(1, n)) * TAU);
        k = 0.45 + 0.55 * w * w;
      } else k = 0.8;
      segs[i] = k;
    }
    faceMaterial.uniforms.uGlowStrength.value = lk.glow;
    faceMaterial.uniforms.uWinner.value = win ?? -1;
    faceMaterial.uniforms.uWinPulse.value = winPulse;

    const leds = ledsRef.current;
    if (leds) {
      for (let k = 0; k < LED_COUNT; k++) {
        let b: number;
        if (win !== null) b = 0.55 + 0.45 * Math.sin(now / 90 + k * 0.9);
        else if (activeSpinPlan || ph === "preparing") b = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * (10 + speedNorm * 18) - k * 0.8));
        else if (animate) b = 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(t * 2.4 * lk.lightSpeed - k * 0.55), 3);
        else b = 0.8;
        tmpColor.copy(ledColors[k % 2]).multiplyScalar(0.25 + b * 1.25);
        leds.setColorAt(k, tmpColor);
      }
      if (leds.instanceColor) leds.instanceColor.needsUpdate = true;
    }
    if (gemMatRef.current) {
      const g = win !== null ? 1.6 + 0.6 * winPulse : activeSpinPlan ? 1.2 + speedNorm * 0.5 : 1;
      gemMatRef.current.color.set(lk.accent).multiplyScalar(g);
    }
    if (haloRef.current) {
      const base = 0.55 + (activeSpinPlan ? 0.35 * speedNorm : 0) + (win !== null ? 0.3 : 0);
      haloRef.current.opacity = Math.min(1, base * Math.max(0.3, lk.glow));
    }
  });

  return (
    <group>
      {/* Soft coloured halo behind everything */}
      <mesh position={[0, 0, -0.6]} renderOrder={-1}>
        <planeGeometry args={[R * 3.6, R * 3.6]} />
        <meshBasicMaterial ref={haloRef} map={halo} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>

      {/* ---- Stand ---- */}
      <group position={[0, -R - 0.95, -0.25]}>
        <RoundedBox args={[5.4, 0.34, 1.5]} radius={0.12} smoothness={4}>
          <meshStandardMaterial color="#141A2E" metalness={0.9} roughness={0.25} />
        </RoundedBox>
        <mesh position={[0, 0.18, 0.76]}>
          <boxGeometry args={[5.0, 0.03, 0.02]} />
          <meshBasicMaterial color={look.accent} toneMapped={false} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 0.9, 0.62, 0]} rotation={[0, 0, side * 0.42]}>
            <boxGeometry args={[0.16, 1.3, 0.22]} />
            <meshStandardMaterial color="#B9C2D3" metalness={1} roughness={0.22} />
          </mesh>
        ))}
      </group>

      {/* ---- Static frame: back plate, chrome rim, neon line, LED pegs ---- */}
      <mesh position={[0, 0, -0.22]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[R + 0.42, R + 0.42, 0.18, 96]} />
        <meshStandardMaterial color="#0C1124" metalness={0.85} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0, 0.05]}>
        <torusGeometry args={[R + 0.24, 0.2, 32, 160]} />
        <meshStandardMaterial color="#C9D2E3" metalness={1} roughness={0.16} />
      </mesh>
      <mesh position={[0, 0, 0.12]}>
        <torusGeometry args={[R + 0.035, 0.022, 12, 160]} />
        <meshBasicMaterial color={look.accent} toneMapped={false} />
      </mesh>
      <instancedMesh ref={ledsRef} args={[undefined, undefined, LED_COUNT]}>
        <capsuleGeometry args={[0.055, 0.16, 6, 12]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      {/* ---- Rotating wheel ---- */}
      <group ref={wheelRef}>
        <mesh position={[0, 0, -0.06]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[R + 0.02, R + 0.02, 0.24, 96]} />
          <meshStandardMaterial color="#10162B" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0, 0.065]} material={faceMaterial}>
          <circleGeometry args={[R, 128]} />
        </mesh>
        {/* Glass cover: catches environment highlights for depth */}
        <mesh position={[0, 0, 0.11]}>
          <circleGeometry args={[R, 96]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.07} roughness={0.05} metalness={0} depthWrite={false} />
        </mesh>

        {/* Hub: brushed steel cap, neon ring and logo */}
        <group position={[0, 0, 0.12]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[R * FACE.inner * 0.98, R * FACE.inner, 0.16, 64]} />
            <meshStandardMaterial color="#1A2138" metalness={0.95} roughness={0.25} />
          </mesh>
          <mesh position={[0, 0, 0.085]}>
            <torusGeometry args={[R * FACE.inner * 0.9, 0.035, 16, 96]} />
            <meshBasicMaterial color={look.accent} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0, 0.1]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[R * FACE.inner * 0.78, R * FACE.inner * 0.82, 0.08, 64]} />
            <meshStandardMaterial map={brushed} metalness={1} roughness={0.28} />
          </mesh>
          <mesh position={[0, 0, 0.145]}>
            <circleGeometry args={[R * FACE.inner * 0.62, 64]} />
            <meshBasicMaterial map={logo} transparent toneMapped={false} />
          </mesh>
        </group>
      </group>

      {/* ---- Pointer (fixed at the top) ---- */}
      <group position={[0, R + 0.32, 0.42]}>
        <group ref={pointerRef}>
          {/* Hinge at the head; geometry hangs below it so ticks swing the tip. */}
          <group position={[0, -0.1, 0]}>
            <mesh geometry={pointerOutline} position={[0, 0, -0.06]}>
              <meshBasicMaterial color={look.accent} toneMapped={false} />
            </mesh>
            <mesh geometry={pointerGeom}>
              <meshStandardMaterial color="#DCE3F0" metalness={1} roughness={0.14} />
            </mesh>
            <mesh position={[0, 0.16, 0.16]} scale={[0.17, 0.2, 0.08]}>
              <octahedronGeometry args={[1, 0]} />
              <meshBasicMaterial ref={gemMatRef} color={look.accent} toneMapped={false} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}
