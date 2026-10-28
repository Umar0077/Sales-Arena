import { redirect } from "next/navigation";

// The Live Arena now lives at "/" (leaderboard and spinner are part of it).
export default function Page() {
  redirect("/");
}
