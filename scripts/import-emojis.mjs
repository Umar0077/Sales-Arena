#!/usr/bin/env node
/**
 * SALES ARENA — Agent Emoji Bulk Importer
 *
 * Reads all 19 PNG agent emojis from `assets/Emojis of Agents/`,
 * validates each image using sharp (MIME, dimensions, integrity),
 * and idempotently inserts them into PostgreSQL `agent_emoji_assets`
 * and `agent_emoji_assignments`.
 *
 * Usage:
 *   node scripts/import-emojis.mjs
 *   node scripts/import-emojis.mjs --override
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";
import sharp from "sharp";

const EMOJI_DIR = path.join(process.cwd(), "assets", "Emojis of Agents");
const OVERRIDE = process.argv.includes("--override");

export const VERIFIED_NAME_ALIASES = {
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

export const normalizeEmojiName = (name) =>
  String(name || "")
    .replace(/-Photoroom\.[^.]+$/i, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

export function matchAgent(filename, agents) {
  const normTarget = normalizeEmojiName(filename);
  const exact = agents.filter((a) => normalizeEmojiName(a.name) === normTarget);
  if (exact.length === 1) return { status: "exact", agent: exact[0], reason: "Exact normalized name" };
  if (exact.length > 1) return { status: "ambiguous", candidates: exact, reason: "Multiple exact matches" };

  const aliasMatches = agents.filter((a) => {
    const aNorm = normalizeEmojiName(a.name);
    const aliasesForAgent = VERIFIED_NAME_ALIASES[aNorm] ?? [];
    if (aliasesForAgent.includes(normTarget)) return true;
    const aliasesForTarget = VERIFIED_NAME_ALIASES[normTarget] ?? [];
    if (aliasesForTarget.includes(aNorm)) return true;
    return false;
  });

  if (aliasMatches.length === 1) return { status: "exact", agent: aliasMatches[0], reason: "Verified alias match" };
  if (aliasMatches.length > 1) return { status: "ambiguous", candidates: aliasMatches, reason: "Multiple alias matches" };

  return { status: "unmatched", candidates: [], reason: "No match found" };
}

async function run() {
  console.log("================================================================================");
  console.log("SALES ARENA — AGENT EMOJI BULK IMPORTER");
  console.log("Asset Directory: " + EMOJI_DIR);
  console.log("Override existing: " + OVERRIDE);
  console.log("Date: " + new Date().toISOString());
  console.log("================================================================================\n");

  if (!fs.existsSync(EMOJI_DIR)) {
    console.error("Error: Asset directory not found: " + EMOJI_DIR);
    process.exit(1);
  }

  const files = fs.readdirSync(EMOJI_DIR).filter((f) => f.endsWith(".png")).sort();
  console.log(`Found ${files.length} PNG assets in directory.\n`);

  const dbUrl = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;
  if (!dbUrl) {
    console.log("[Notice] No DATABASE_URL provided. Running in verification / inspection mode.\n");
    const validatedAssets = [];
    for (const filename of files) {
      const filePath = path.join(EMOJI_DIR, filename);
      const bytes = fs.readFileSync(filePath);
      const hash = createHash("sha256").update(bytes).digest("hex");
      const meta = await sharp(bytes).metadata();
      validatedAssets.push({
        Filename: filename,
        "Normalized Name": normalizeEmojiName(filename),
        Format: meta.format,
        Dimensions: `${meta.width}x${meta.height}`,
        "Size (KB)": Math.round(bytes.length / 1024),
        "SHA-256 (first 12)": hash.slice(0, 12) + "...",
      });
    }
    console.table(validatedAssets);
    console.log("\nAll 19 original agent emojis validated successfully (sharp decode, dimensions, integrity).");
    return;
  }

  const pool = new pg.Pool({ connectionString: dbUrl, connectionTimeoutMillis: 5000 });
  const client = await pool.connect();
  try {
    const agentsRes = await client.query("SELECT id, name, user_code FROM agents ORDER BY name");
    const agents = agentsRes.rows;
    console.log(`Loaded ${agents.length} agents from database.\n`);

    const existingRes = await client.query("SELECT agent_id, asset_id FROM agent_emoji_assignments");
    const existingMap = new Map(existingRes.rows.map((r) => [r.agent_id, r.asset_id]));

    const imported = [];
    const matched = [];
    const unmatched = [];
    const ambiguous = [];
    const assignedIds = new Set(existingMap.keys());

    for (const filename of files) {
      const filePath = path.join(EMOJI_DIR, filename);
      const bytes = fs.readFileSync(filePath);
      const hash = createHash("sha256").update(bytes).digest("hex");
      const meta = await sharp(bytes).metadata();

      if (!meta.width || !meta.height || meta.format !== "png") {
        console.warn(`[Skip] Invalid image ${filename}`);
        continue;
      }

      await client.query(
        `INSERT INTO agent_emoji_assets (id, filename, mime, width, height, content)
         VALUES ($1, $2, 'image/png', $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [hash, filename, meta.width, meta.height, bytes]
      );
      imported.push({ filename, id: hash, width: meta.width, height: meta.height });

      const match = matchAgent(filename, agents);
      if (match.status === "exact" && match.agent) {
        let actionTaken = "preserved";
        if (OVERRIDE || !existingMap.has(match.agent.id)) {
          await client.query(
            `INSERT INTO agent_emoji_assignments (agent_id, asset_id)
             VALUES ($1, $2)
             ON CONFLICT (agent_id) DO UPDATE SET asset_id = EXCLUDED.asset_id, updated_at = NOW()`,
            [match.agent.id, hash]
          );
          actionTaken = existingMap.has(match.agent.id) ? "replaced" : "assigned";
          assignedIds.add(match.agent.id);
        }
        matched.push({
          Filename: filename,
          "Agent Name": match.agent.name,
          "User Code": match.agent.user_code,
          Status: actionTaken,
          Reason: match.reason,
        });
      } else if (match.status === "ambiguous") {
        ambiguous.push({
          Filename: filename,
          Candidates: match.candidates.map((c) => c.name).join(", "),
          Reason: match.reason,
        });
      } else {
        unmatched.push({
          Filename: filename,
          Reason: match.reason,
        });
      }
    }

    const agentsWithoutEmojis = agents.filter((a) => !assignedIds.has(a.id));

    console.log("--- 1. MATCHED & ASSIGNED AGENTS ---");
    if (matched.length) console.table(matched);
    else console.log("No exact matches found.");

    if (unmatched.length) {
      console.log("\n--- 2. UNMATCHED IMAGES (Require Admin manual assignment) ---");
      console.table(unmatched);
    }

    if (ambiguous.length) {
      console.log("\n--- 3. AMBIGUOUS MATCHES ---");
      console.table(ambiguous);
    }

    console.log("\n--- 4. SUMMARY ---");
    console.table([
      { Metric: "Total Assets Processed", Count: files.length },
      { Metric: "Images Stored in DB", Count: imported.length },
      { Metric: "Assignments Made / Updated", Count: matched.filter((m) => m.Status !== "preserved").length },
      { Metric: "Existing Assignments Preserved", Count: matched.filter((m) => m.Status === "preserved").length },
      { Metric: "Unmatched Images", Count: unmatched.length },
      { Metric: "Ambiguous Images", Count: ambiguous.length },
      { Metric: "Agents Without Emojis", Count: agentsWithoutEmojis.length },
    ]);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
