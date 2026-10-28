import {
  Trophy, Gift, Package, Headphones, BadgeCheck, Sparkles, Coffee, Ticket, Star, Crown, Rocket, Medal,
  type IconNode,
} from "lucide";
import type { Reward, RewardIcon } from "@/types";

/**
 * 2D drawing of the wheel face, shared by the 3D wheel (as a texture) and the
 * 2D fallback. Segment i spans [i·s, (i+1)·s] clockwise from the top — the same
 * convention as features/spins/wheel-math.ts.
 */

export const ICON_NODES: Record<RewardIcon, IconNode> = {
  trophy: Trophy, gift: Gift, package: Package, headphones: Headphones, badge: BadgeCheck, sparkles: Sparkles,
  coffee: Coffee, ticket: Ticket, star: Star, crown: Crown, rocket: Rocket, medal: Medal,
};

/** Proportions of the face, as fractions of its radius. */
export const FACE = { inner: 0.25, outer: 0.965, iconR: 0.8, textR: 0.56, gapPx: 10 } as const;

/** The page's Sora family string (next/font sets --font-sora on <html>). */
export function soraFamily(): string {
  if (typeof document === "undefined") return "sans-serif";
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-sora").trim();
  return v ? `${v}, sans-serif` : "sans-serif";
}

/** Resolves once Sora is ready for canvas text (or after a short timeout). */
export async function ensureSoraLoaded(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const fam = soraFamily();
  try {
    await Promise.race([
      Promise.all([document.fonts.load(`800 64px ${fam}`), document.fonts.load(`600 32px ${fam}`)]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    /* fall back to the system font */
  }
}

function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Draws a lucide icon (24×24 viewBox) centred at (0,0). */
export function drawIcon(ctx: CanvasRenderingContext2D, node: IconNode, size: number, color: string): void {
  ctx.save();
  const k = size / 24;
  ctx.scale(k, k);
  ctx.translate(-12, -12);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.fillStyle = "transparent";
  for (const [tag, attrs] of node) {
    const a = attrs as Record<string, string | number | undefined>;
    const num = (key: string) => Number(a[key] ?? 0);
    if (tag === "path" && a.d) ctx.stroke(new Path2D(String(a.d)));
    else if (tag === "circle") {
      ctx.beginPath();
      ctx.arc(num("cx"), num("cy"), num("r"), 0, Math.PI * 2);
      ctx.stroke();
    } else if (tag === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(num("cx"), num("cy"), num("rx"), num("ry"), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (tag === "rect") {
      ctx.beginPath();
      ctx.roundRect(num("x"), num("y"), num("width"), num("height"), num("rx"));
      ctx.stroke();
    } else if (tag === "line") {
      ctx.beginPath();
      ctx.moveTo(num("x1"), num("y1"));
      ctx.lineTo(num("x2"), num("y2"));
      ctx.stroke();
    } else if ((tag === "polyline" || tag === "polygon") && a.points) {
      const pts = String(a.points).trim().split(/[\s,]+/).map(Number);
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 2) (i === 0 ? ctx.moveTo : ctx.lineTo).call(ctx, pts[i], pts[i + 1]);
      if (tag === "polygon") ctx.closePath();
      ctx.stroke();
    }
  }
  ctx.restore();
}

function wedgePath(ctx: CanvasRenderingContext2D, start: number, end: number, rIn: number, rOut: number, gap: number): void {
  // Gap is a constant pixel width, so convert it to an angle at each radius.
  const gOut = gap / 2 / rOut;
  const gIn = gap / 2 / rIn;
  ctx.beginPath();
  ctx.arc(0, 0, rOut, start + gOut, end - gOut);
  ctx.arc(0, 0, rIn, end - gIn, start + gIn, true);
  ctx.closePath();
}

/** Splits a title into at most two lines that fit `maxWidth`. */
function fitTitle(ctx: CanvasRenderingContext2D, title: string, maxWidth: number, family: string, maxPx: number, minPx: number) {
  const text = title.toUpperCase();
  for (let px = maxPx; px >= minPx; px -= 2) {
    ctx.font = `800 ${px}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) return { lines: [text], px };
    const words = text.split(" ");
    if (words.length > 1) {
      let best: string[] | null = null;
      let bestW = Infinity;
      for (let i = 1; i < words.length; i++) {
        const l1 = words.slice(0, i).join(" ");
        const l2 = words.slice(i).join(" ");
        const w = Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width);
        if (w < bestW) {
          bestW = w;
          best = [l1, l2];
        }
      }
      if (best && bestW <= maxWidth) return { lines: best, px: px * 0.92 };
    }
  }
  ctx.font = `800 ${minPx}px ${family}`;
  return { lines: [text], px: minPx };
}

export interface FaceOptions {
  rewards: Reward[];
  colors: string[];
  size: number;
}

/** Base face: dark glass segments tinted with their neon colour, icons and Sora labels. */
export function drawWheelFace(canvas: HTMLCanvasElement, { rewards, colors, size }: FaceOptions): void {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const R = size / 2;
  const n = rewards.length;
  const s = (Math.PI * 2) / n;
  const rIn = R * FACE.inner;
  const rOut = R * FACE.outer;
  const fam = soraFamily();

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(R, R);

  // Dark backing disc, so the gaps between segments read as deep grooves.
  const back = ctx.createRadialGradient(0, 0, rIn * 0.5, 0, 0, R);
  back.addColorStop(0, "#05070F");
  back.addColorStop(1, "#0B1022");
  ctx.fillStyle = back;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < n; i++) {
    const start = -Math.PI / 2 + i * s;
    const end = start + s;
    const mid = start + s / 2;
    const color = colors[i];

    // Glass fill: deep at the hub, richer toward the rim.
    const fill = ctx.createRadialGradient(0, 0, rIn, 0, 0, rOut);
    fill.addColorStop(0, rgba(color, 0.16));
    fill.addColorStop(0.55, rgba(color, 0.3));
    fill.addColorStop(1, rgba(color, 0.5));
    wedgePath(ctx, start, end, rIn, rOut, FACE.gapPx * (size / 2048));
    ctx.fillStyle = "#0A0E1F";
    ctx.fill();
    ctx.fillStyle = fill;
    ctx.fill();

    // Sheen across the outer half (glass reflection).
    ctx.save();
    ctx.clip();
    const sheen = ctx.createLinearGradient(Math.cos(mid) * rIn, Math.sin(mid) * rIn, Math.cos(mid) * rOut, Math.sin(mid) * rOut);
    sheen.addColorStop(0, "rgba(255,255,255,0)");
    sheen.addColorStop(0.75, "rgba(255,255,255,0.05)");
    sheen.addColorStop(1, "rgba(255,255,255,0.14)");
    ctx.fillStyle = sheen;
    ctx.fillRect(-R, -R, size, size);
    ctx.restore();

    // Crisp inner neon line (the glow layer adds the bloom).
    const inset = 14 * (size / 2048);
    wedgePath(ctx, start, end, rIn + inset, rOut - inset, FACE.gapPx * (size / 2048) + inset * 2);
    ctx.lineWidth = 5 * (size / 2048);
    ctx.strokeStyle = rgba(color, 0.95);
    ctx.stroke();

    // Content is rotated so "up" points out toward the rim (as in the reference).
    ctx.save();
    ctx.rotate(mid + Math.PI / 2);

    const icon = ICON_NODES[rewards[i].icon] ?? Gift;
    const iconSize = Math.min(R * 0.12, s * R * FACE.iconR * 0.42);
    ctx.save();
    ctx.translate(0, -R * FACE.iconR);
    ctx.shadowColor = color;
    ctx.shadowBlur = 18 * (size / 2048);
    drawIcon(ctx, icon, iconSize, "#FFFFFF");
    ctx.restore();

    // Two layouts: across the segment (like the reference) or along the radius.
    // Use whichever gives the larger, more readable text.
    const across = fitTitle(ctx, rewards[i].title, 2 * Math.sin(s / 2) * R * FACE.textR * 0.86, fam, R * 0.085, R * 0.035);
    const radialLen = (FACE.iconR - 0.12 - (FACE.inner + 0.06)) * R;
    const along = fitTitle(ctx, rewards[i].title, radialLen, fam, R * 0.085, R * 0.035);
    // Radial text stacks lines across the wedge, so they must fit its width there.
    const alongFits = along.lines.length * along.px * 1.1 <= 2 * Math.sin(s / 2) * R * 0.5 * 0.9;
    const useRadial = alongFits && along.px > across.px * 1.15;
    const { lines, px } = useRadial ? along : across;
    ctx.font = `800 ${px}px ${fam}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = rgba(color, 0.9);
    ctx.shadowBlur = 16 * (size / 2048);
    ctx.fillStyle = "#FFFFFF";
    const lh = px * 1.08;
    if (useRadial) {
      // Read from the hub outward.
      const centre = ((FACE.inner + 0.06 + FACE.iconR - 0.12) / 2) * R;
      ctx.translate(0, -centre);
      ctx.rotate(-Math.PI / 2);
      lines.forEach((line, li) => ctx.fillText(line, 0, (li - (lines.length - 1) / 2) * lh));
    } else {
      lines.forEach((line, li) => ctx.fillText(line, 0, -R * FACE.textR + (li - (lines.length - 1) / 2) * lh));
    }
    ctx.restore();
  }

  // Hub socket ring.
  ctx.beginPath();
  ctx.arc(0, 0, rIn - 6 * (size / 2048), 0, Math.PI * 2);
  ctx.fillStyle = "#070A16";
  ctx.fill();
  ctx.restore();
}

/** Neon glow layer: soft, coloured outlines on black, added on top of the face in the shader. */
export function drawGlowMask(canvas: HTMLCanvasElement, { rewards, colors, size }: FaceOptions): void {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const R = size / 2;
  const n = rewards.length;
  const s = (Math.PI * 2) / n;
  const k = size / 1024;
  const rIn = R * FACE.inner;
  const rOut = R * FACE.outer;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.translate(R, R);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < n; i++) {
    const start = -Math.PI / 2 + i * s;
    const inset = 7 * k;
    for (const [blur, width, alpha] of [
      [26 * k, 7 * k, 0.55],
      [10 * k, 4 * k, 0.8],
      [0, 2 * k, 1],
    ] as const) {
      wedgePath(ctx, start, start + s, rIn + inset, rOut - inset, FACE.gapPx * k * 0.5 + inset * 2);
      ctx.shadowColor = colors[i];
      ctx.shadowBlur = blur;
      ctx.lineWidth = width;
      ctx.strokeStyle = rgba(colors[i], alpha);
      ctx.stroke();
    }
  }
  ctx.restore();
}
