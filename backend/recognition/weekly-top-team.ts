import type { Pool } from "pg";
import { writeAudit } from "../auth/guard";
import { arenaBroadcaster } from "../events/broadcaster";
import { computeStandings } from "../teams/standings";
import { RecognitionError } from "./weekly-top";

/**
 * Weekly Top Team Performers recognition (Admin → Celebrations).
 * Reuses the existing weekly team standings (`computeStandings(pool, "week")`) with zero duplicate scoring logic.
 * Once per business week under a row lock, audited, broadcast via `arena.recognition.weekly_top_team`.
 */

export const RECOGNITION_TEAM_KEY = "recognition.weekly_top_team";
export const RECOGNITION_TEAM_EVENT = "arena.recognition.weekly_top_team";

export interface WeeklyTopTeamMember {
  userCode: string;
  name: string;
  designation: string | null;
  validated: number;
  submitted: number;
}

export interface WeeklyTopTeamInfo {
  id: string;
  slug: string | null;
  name: string;
  logoUrl: string | null;
  color: string;
  accentSecondary: string | null;
  validated: number;
  submitted: number;
  closeRate: number | null;
  members: WeeklyTopTeamMember[];
}

export interface WeeklyTopTeamCelebrated {
  teamId: string;
  teamName: string;
  validated: number;
  weekFrom: string;
  weekTo: string;
  at: string;
  by: string | null;
}

export interface WeeklyTopTeamState {
  week: { from: string; to: string; label: string };
  topTeam: WeeklyTopTeamInfo | null;
  tiedWith: string | null;
  celebrated: WeeklyTopTeamCelebrated | null;
}

/** This business week's #1 team and its full member roster (read-only). */
export async function weeklyTopTeam(
  pool: Pool,
  opts: { now?: Date } = {},
): Promise<WeeklyTopTeamState> {
  const standings = await computeStandings(pool, "week", opts);
  const ranked = standings.teams.filter((t) => t.validated > 0);
  const first = ranked[0] ?? null;
  const tiedWith =
    first && ranked[1] && ranked[1].validated === first.validated ? ranked[1].name : null;

  const topTeam: WeeklyTopTeamInfo | null = first
    ? {
        id: first.id,
        slug: first.slug,
        name: first.name,
        logoUrl: first.logoUrl,
        color: first.color,
        accentSecondary: first.accentSecondary,
        validated: first.validated,
        submitted: first.submitted,
        closeRate: first.closeRate,
        members: first.members.map((m) => ({
          userCode: m.userCode,
          name: m.name,
          designation: m.designation,
          validated: m.validated,
          submitted: m.submitted,
        })),
      }
    : null;

  const stored = (
    await pool.query(
      `SELECT s.value, u.email
         FROM admin_settings s
         LEFT JOIN admin_users u ON u.id::text = s.value->>'adminId'
        WHERE s.key = $1`,
      [RECOGNITION_TEAM_KEY],
    )
  ).rows[0];

  const v = stored?.value as (Omit<WeeklyTopTeamCelebrated, "by"> & { adminId?: string }) | undefined;
  const celebrated =
    v && v.weekFrom === standings.from
      ? {
          teamId: v.teamId,
          teamName: v.teamName,
          validated: v.validated,
          weekFrom: v.weekFrom,
          weekTo: v.weekTo,
          at: v.at,
          by: stored.email ?? null,
        }
      : null;

  return {
    week: { from: standings.from, to: standings.to, label: standings.label },
    topTeam,
    tiedWith,
    celebrated,
  };
}

/** Celebrates this week's #1 team once per business week and broadcasts it to every Live Arena display. */
export async function celebrateWeeklyTopTeam(
  pool: Pool,
  actor: { adminId: string; ip: string | null; userAgent: string | null },
  opts: { now?: Date } = {},
): Promise<{ id: string; week: WeeklyTopTeamState["week"]; topTeam: WeeklyTopTeamInfo }> {
  const state = await weeklyTopTeam(pool, opts);
  if (!state.topTeam) {
    throw new RecognitionError(422, "No competing team has approved sales this week yet.");
  }
  const topTeam = state.topTeam;
  const id = `weekly-top-team:${state.week.from}`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO admin_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [RECOGNITION_TEAM_KEY, JSON.stringify({})],
    );
    const cur = (
      await client.query(`SELECT value FROM admin_settings WHERE key = $1 FOR UPDATE`, [RECOGNITION_TEAM_KEY])
    ).rows[0].value as { weekFrom?: string; at?: string; teamName?: string };
    if (cur.weekFrom === state.week.from) {
      await client.query("ROLLBACK");
      throw new RecognitionError(
        409,
        `This week's top team was already celebrated (${cur.teamName ?? "team"}, ${
          cur.at ? new Date(cur.at).toLocaleString("en-US") : "earlier"
        }).`,
      );
    }
    const at = new Date().toISOString();
    const value = {
      weekFrom: state.week.from,
      weekTo: state.week.to,
      teamId: topTeam.id,
      teamName: topTeam.name,
      validated: topTeam.validated,
      at,
      adminId: actor.adminId,
    };
    await client.query(`UPDATE admin_settings SET value = $2 WHERE key = $1`, [
      RECOGNITION_TEAM_KEY,
      JSON.stringify(value),
    ]);
    await writeAudit(client, {
      adminId: actor.adminId,
      action: "recognition.weekly_top_team.celebrated",
      targetType: "team",
      targetId: topTeam.id,
      details: {
        week: `${state.week.from}..${state.week.to}`,
        teamName: topTeam.name,
        validated: topTeam.validated,
        memberCount: topTeam.members.length,
      },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  arenaBroadcaster.broadcast(RECOGNITION_TEAM_EVENT, {
    id,
    from: state.week.from,
    to: state.week.to,
    label: state.week.label,
    teamId: topTeam.id,
    teamName: topTeam.name,
    teamLogoUrl: topTeam.logoUrl,
    teamColor: topTeam.color,
    validated: topTeam.validated,
    members: topTeam.members.map((m) => ({
      userCode: m.userCode,
      name: m.name,
      validated: m.validated,
      designation: m.designation,
    })),
    at: new Date().toISOString(),
  });

  return { id, week: state.week, topTeam };
}
