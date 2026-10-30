import { redirect } from "next/navigation";

/** The FE campaign has no team structure; closers are managed individually by Safe Quote userCode. */
export default function TeamsRemovedPage() {
  redirect("/admin");
}
