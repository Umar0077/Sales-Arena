import { describe, expect, it } from "vitest";
import { closeRateOf, leaderOf, rankMembers, rankTeams, topPerformers, type MemberStats, type TeamInput } from "@/lib/teams/ranking";
import { matchRosterName, normalizeName, type Candidate } from "@/lib/teams/matching";
import { INITIAL_ROSTER } from "@/lib/teams/initial-roster";
import { audienceOk } from "@/lib/server/rewards/engine";
import { normalizeProgram, programSignature } from "@/lib/server/rewards/programs";
import { resolveMode } from "@/store/arena-mode-store";

const m = (name: string, validated: number, submitted: number, designation: "senior" | "junior" | null = "senior"): MemberStats => ({
  userCode: `CLS-${name.toUpperCase().replace(/\W/g, "")}`,
  name,
  designation,
  validated,
  submitted,
  closeRate: closeRateOf(validated, submitted),
});
const team = (id: string, members: MemberStats[], displayOrder = 1): TeamInput => ({
  id, name: `Team ${id}`, slug: id, logoUrl: `/teams/team-${id}.webp`, color: "#22D3FF", accentSecondary: null, displayOrder, leaderUserCode: null, members,
});

describe("team ranking (genuine data only, deterministic)", () => {
  it("the team with the most validated sales wins; submitted leads break ties; never cash, never random", () => {
    const r = rankTeams([team("a", [m("A1", 3, 9), m("A2", 0, 0)], 1), team("b", [m("B1", 5, 6)], 2), team("c", [m("C1", 3, 12)], 3)]);
    expect(r.map((t) => [t.id, t.rank, t.validated, t.submitted])).toEqual([["b", 1, 5, 6], ["c", 2, 3, 12], ["a", 3, 3, 9]]);
    expect(leaderOf(r)).toBe("b");
  });
  it("fully tied teams share the placement; order falls back to the Admin display order; no leader for a shared lead", () => {
    const r = rankTeams([team("z", [m("Z", 2, 4)], 2), team("y", [m("Y", 2, 4)], 1)]);
    expect(r.map((t) => [t.id, t.rank, t.tied])).toEqual([["y", 1, true], ["z", 1, true]]);
    expect(leaderOf(r)).toBeNull();
    expect(leaderOf(rankTeams([team("q", [m("Q", 0, 3)])]))).toBeNull(); // no sales yet: no leader / no takeover
  });
  it("members: validated ↓, submitted ↓, then name; zero-sale members stay listed at the bottom", () => {
    const r = rankMembers([m("Zed", 0, 0), m("Amy", 2, 3), m("Bob", 2, 5), m("Cat", 0, 4), m("Dan", 0, 0)]);
    expect(r.map((x) => [x.name, x.rank])).toEqual([["Bob", 1], ["Amy", 2], ["Cat", 3], ["Dan", 4], ["Zed", 4]]);
    expect(r.filter((x) => x.validated === 0)).toHaveLength(3);
    expect(r[3].tied && r[4].tied).toBe(true);
  });
  it("member count excludes former members; team close rate from totals", () => {
    const r = rankTeams([team("a", [m("A1", 2, 4), { ...m("A2", 1, 1), former: true }])]);
    expect(r[0]).toMatchObject({ memberCount: 1, validated: 3, submitted: 5, closeRate: 60 });
  });
  it("overall top 3 across all teams: real members with sales only, with their team", () => {
    const r = rankTeams([team("a", [m("Ann", 4, 6), m("Al", 0, 9)]), team("b", [m("Ben", 4, 8), m("Bea", 1, 1)]), team("c", [m("Cy", 2, 2)])]);
    const top = topPerformers(r);
    expect(top.map((p) => [p.name, p.teamId, p.rank])).toEqual([["Ben", "b", 1], ["Ann", "a", 2], ["Cy", "c", 3]]);
    expect(topPerformers(rankTeams([team("a", [m("X", 0, 5)])]))).toEqual([]);
  });
  it("close rate is null without submitted leads (never a fake 0 % / 100 %)", () => {
    expect(closeRateOf(0, 0)).toBeNull();
    expect(closeRateOf(1, 3)).toBe(33.3);
  });
});

describe("roster identity matching (classifies, never decides)", () => {
  const cands: Candidate[] = [
    { userCode: "CLS-1", name: "Rehan Ali", sources: ["safequote"] },
    { userCode: "CLS-2", name: "Muhammad Adeel Afzal", sources: ["agents"] },
    { userCode: "CLS-3", name: "Syed Ali Asghar Zaidi", sources: ["safequote"] },
    { userCode: "CLS-4", name: "Urwah Malik", sources: ["safequote"] },
    { userCode: "CLS-5", name: "Uswa E Husna", sources: ["safequote"] },
    { userCode: "CLS-6", name: "Ali Raza", sources: ["agents"] },
    { userCode: "CLS-7", name: "Ali Raza", sources: ["safequote"] },
  ];
  it("identical names are exact (case / spacing / punctuation ignored)", () => {
    expect(matchRosterName(" rehan  ALI ", cands)).toMatchObject({ status: "exact", candidates: [{ userCode: "CLS-1" }] });
    expect(normalizeName("Sahibzada  Hassan-Mehboob")).toBe("sahibzada hassan mehboob");
  });
  it("title / longer-name variations are only possible matches", () => {
    expect(matchRosterName("Adeel Afzal", cands)).toMatchObject({ status: "possible", candidates: [{ userCode: "CLS-2" }] });
    expect(matchRosterName("Ali Asghar", cands).status).toBe("possible");
  });
  it("a spelling close to two people is ambiguous, two identical names are multiple, nothing is unmatched", () => {
    expect(matchRosterName("Uswah", cands)).toMatchObject({ status: "multiple" });
    expect(matchRosterName("Ali Raza", cands)).toMatchObject({ status: "multiple" });
    expect(matchRosterName("Roger Robinson", cands)).toEqual({ status: "unmatched", candidates: [] });
  });
});

describe("the supplied roster (import preview data only)", () => {
  it("three official teams, 10 members each (5 SR + 5 Jr), Team Panthers (not Beta); leaders are not members", () => {
    expect(INITIAL_ROSTER.map((t) => t.name)).toEqual(["Team Alpha", "Team Panthers", "Team Sigma"]);
    for (const t of INITIAL_ROSTER) {
      expect(t.members).toHaveLength(10);
      expect(t.members.filter((x) => x.designation === "senior")).toHaveLength(5);
      expect(t.members.some((x) => x.name === t.leaderReference)).toBe(false);
      expect(t.logoUrl).toMatch(/^\/teams\/team-[a-z]+\.webp$/);
    }
    const names = INITIAL_ROSTER.flatMap((t) => t.members.map((x) => x.name));
    expect(new Set(names).size).toBe(30); // nobody twice
  });
});

describe("Senior / Junior reward audience", () => {
  it("all-agent programmes keep today's behaviour; senior / junior need the matching designation", () => {
    expect(audienceOk({ audience: "all" }, null)).toBe(true);
    expect(audienceOk({ audience: "all" }, "junior")).toBe(true);
    expect(audienceOk({ audience: "senior" }, "senior")).toBe(true);
    expect(audienceOk({ audience: "senior" }, "junior")).toBe(false);
    expect(audienceOk({ audience: "senior" }, null)).toBe(false);
    expect(audienceOk({ audience: "junior" }, "junior")).toBe(true);
    expect(audienceOk({ audience: "junior" }, "senior")).toBe(false);
  });
  const base = { kind: "daily", name: "T", rewardType: "cash", amount: 2000, salesRequired: 2 };
  it("Junior programmes get their own reward group; others can never use a junior group", () => {
    expect(normalizeProgram({ ...base, audience: "junior" })).toMatchObject({ audience: "junior", rewardGroup: "junior" });
    expect(normalizeProgram({ ...base, audience: "junior", rewardGroup: "junior-team" }).rewardGroup).toBe("junior-team");
    expect(() => normalizeProgram({ ...base, audience: "junior", rewardGroup: "default2" })).toThrow(/junior/);
    expect(() => normalizeProgram({ ...base, audience: "senior", rewardGroup: "junior" })).toThrow(/reserved/);
    expect(normalizeProgram({ ...base })).toMatchObject({ audience: "all", rewardGroup: "default" });
  });
  it("an ordinary edit can never change an existing programme's audience", () => {
    const cur = { ...normalizeProgram({ ...base }), id: "p", status: "active", activeSince: null, archivedAt: null, revision: 1, createdAt: "", updatedAt: "" } as Parameters<typeof normalizeProgram>[1];
    expect(() => normalizeProgram({ audience: "senior" }, cur)).toThrow(/eligibility review/);
    expect(normalizeProgram({ name: "Renamed" }, cur).audience).toBe("all");
  });
  it("duplicate signatures separate audiences (a Junior 2-sale tier never clashes with the Senior one)", () => {
    const s = { kind: "daily" as const, salesRequired: 2, scopeType: "all" as const, scopeIds: [], rewardType: "cash" as const };
    expect(programSignature({ ...s, audience: "senior" })).not.toBe(programSignature({ ...s, audience: "junior", rewardGroup: "junior" }));
    expect(programSignature({ ...s })).toBe(programSignature({ ...s, audience: "all" })); // existing programmes unchanged
  });
});

describe("Teams Arena screen selection", () => {
  const s = { arenaModes: { daily: true, weekly: true, monthly: true, spin: true }, defaultArenaMode: "daily" as const };
  it("missing / off in older settings → never shown; enabled → reachable and can be the default", () => {
    expect(resolveMode("teams", s)).toBe("daily");
    expect(resolveMode("teams", { ...s, arenaModes: { ...s.arenaModes, teams: true } })).toBe("teams");
    expect(resolveMode(null, { arenaModes: { ...s.arenaModes, teams: true }, defaultArenaMode: "teams" })).toBe("teams");
  });
});
