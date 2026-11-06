/**
 * The supplied initial Teams Arena roster (Nov 2026 team-membership sheet), used ONLY by the Owner's
 * read-only import preview. Nothing reads this to rank or display teams: after the Owner confirms the
 * import, every team, membership and designation lives in PostgreSQL and is edited in Team Management.
 *
 * leaderReference: the names in the sheet's header rows. They are NOT agents of the team and are never
 * imported as members; the preview shows them as possible team leaders for the Owner to confirm or skip.
 */

export interface RosterTeam {
  slug: string;
  name: string;
  logoUrl: string;
  color: string;
  accentSecondary: string;
  displayOrder: number;
  leaderReference: string | null;
  members: Array<{ name: string; designation: "senior" | "junior" }>;
}

const sr = (name: string) => ({ name, designation: "senior" as const });
const jr = (name: string) => ({ name, designation: "junior" as const });

export const INITIAL_ROSTER: RosterTeam[] = [
  {
    slug: "alpha",
    name: "Team Alpha",
    logoUrl: "/teams/team-alpha.webp",
    color: "#22D3FF",
    accentSecondary: "#3B82F6",
    displayOrder: 1,
    leaderReference: "Imad Tariq",
    members: [sr("Rehan Ali"), sr("Urwah Malik"), sr("Mansoor"), sr("Rayyan"), sr("Uswah"), jr("Hina Javed"), jr("Roger Robinson"), jr("Abdul Hadi"), jr("Adil Faryad"), jr("Ehsan Zahid")],
  },
  {
    slug: "panthers",
    name: "Team Panthers",
    logoUrl: "/teams/team-panthers.webp",
    color: "#A855F7",
    accentSecondary: "#F5C451",
    displayOrder: 2,
    leaderReference: "Ismail",
    members: [sr("Hamna Nasir"), sr("Balaj"), sr("Ali Asghar"), sr("Noroz"), sr("Jonathan"), jr("Syeda Zubia Farhan"), jr("Sumaiya Majeed"), jr("Mudassir Tanveer"), jr("M Ishaq"), jr("Noor Kiyani")],
  },
  {
    slug: "sigma",
    name: "Team Sigma",
    logoUrl: "/teams/team-sigma.webp",
    color: "#8B5CF6",
    accentSecondary: "#C0C7D6",
    displayOrder: 3,
    leaderReference: "Jeff",
    members: [sr("Arsam Idrees"), sr("Kanwal Farooq"), sr("Adeel Afzal"), sr("Hassan Mehboob"), sr("Haris Malik"), jr("Syed Farhan"), jr("Alishba"), jr("Ali Baloch"), jr("Ali Sikandar"), jr("Rajab Rehan")],
  },
];
