import sharp from "sharp";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import path from "node:path";

export const normalizeEmojiName = (name: string) =>
  name
    .replace(/-Photoroom\.[^.]+$/i, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

/**
 * Verified name aliases mapping canonical full names to known call-center/roster aliases.
 * Used only when exact matching yields no match; ambiguous candidates are never auto-merged.
 */
export const VERIFIED_NAME_ALIASES: Record<string, string[]> = {
  "muhammad adeel afzal": ["adeel afzal"],
  "mansoor arshad": ["mansoor"],
  "rayyan mughal": ["rayyan"],
  "muhammad balaj": ["balaj"],
  "syed ali asghar zaidi": ["ali asghar"],
  "syed noroz ali kazmi": ["noroz"],
  "jonathan joseph": ["jonathan"],
  "sahibzada hassan mehboob": ["hassan mehboob", "sahibzada hassan mehboob khan"],
  "alishba imran": ["alishba"],
  "uswa e husna": ["uswah", "uswa"],
};

export interface AgentMatchCandidate {
  id: string;
  name: string;
  user_code?: string;
}

export interface MatchReport {
  status: "assigned" | "existing assignment preserved" | "ambiguous" | "unmatched";
  matchedAgent?: AgentMatchCandidate;
  candidates: AgentMatchCandidate[];
  reason?: string;
}

/**
 * Safely resolves an agent for an emoji asset filename:
 * 1. Exact normalized name match
 * 2. Single verified alias match (if unambiguous)
 * 3. Ambiguous (if multiple candidates) or unmatched
 */
export function matchAgentForEmoji(
  filename: string,
  agents: AgentMatchCandidate[]
): { status: "exact" | "ambiguous" | "unmatched"; agent?: AgentMatchCandidate; candidates: AgentMatchCandidate[]; reason?: string } {
  const normTarget = normalizeEmojiName(filename);

  // 1. Direct exact normalized match
  const exact = agents.filter((a) => normalizeEmojiName(a.name) === normTarget);
  if (exact.length === 1) {
    return { status: "exact", agent: exact[0], candidates: exact, reason: "Exact normalized name match" };
  }
  if (exact.length > 1) {
    return { status: "ambiguous", candidates: exact, reason: "Multiple agents share this exact name" };
  }

  // 2. Verified alias matching
  const aliasMatches = agents.filter((a) => {
    const aNorm = normalizeEmojiName(a.name);
    // Check if filename is an alias of agent name
    const aliasesForAgent = VERIFIED_NAME_ALIASES[aNorm] ?? [];
    if (aliasesForAgent.includes(normTarget)) return true;
    // Check if agent name is an alias of filename
    const aliasesForTarget = VERIFIED_NAME_ALIASES[normTarget] ?? [];
    if (aliasesForTarget.includes(aNorm)) return true;
    return false;
  });

  if (aliasMatches.length === 1) {
    return { status: "exact", agent: aliasMatches[0], candidates: aliasMatches, reason: "Verified alias match" };
  }
  if (aliasMatches.length > 1) {
    return { status: "ambiguous", candidates: aliasMatches, reason: "Multiple agents match verified aliases" };
  }

  return { status: "unmatched", candidates: [], reason: "No matching agent found" };
}

export async function validateEmoji(bytes: Buffer, filename: string, mime: string) {
  const limit = Math.min(10000000, Math.max(1, Number(process.env.AGENT_EMOJI_MAX_BYTES) || 4000000));
  if (!bytes.length || bytes.length > limit) {
    throw new Error("Image must be nonempty and within the upload size limit.");
  }
  const image = sharp(bytes, { limitInputPixels: 16000000, failOn: "warning" });
  const m = await image.metadata();
  const allowed: Record<string, { mime: string; ext: string[] }> = {
    png: { mime: "image/png", ext: [".png"] },
    jpeg: { mime: "image/jpeg", ext: [".jpg", ".jpeg"] },
    webp: { mime: "image/webp", ext: [".webp"] },
  };
  const kind = allowed[m.format ?? ""];
  if (!kind || kind.mime !== mime || !kind.ext.includes(path.extname(filename).toLowerCase()) || (m.pages ?? 1) > 1) {
    throw new Error("Use a valid static PNG, JPEG or WebP with matching filename and MIME type.");
  }
  if (!m.width || !m.height || m.width > 4096 || m.height > 4096) {
    throw new Error("Image dimensions must not exceed 4096 × 4096.");
  }
  await image.raw().toBuffer(); // Decode fully; never rewrite the original bytes.
  return { id: createHash("sha256").update(bytes).digest("hex"), width: m.width, height: m.height, mime: kind.mime };
}

export async function saveEmoji(db: Pool, bytes: Buffer, filename: string, mime: string) {
  const m = await validateEmoji(bytes, filename, mime);
  await db.query(
    "INSERT INTO agent_emoji_assets (id, filename, mime, width, height, content) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING",
    [m.id, path.basename(filename), m.mime, m.width, m.height, bytes]
  );
  return m;
}
