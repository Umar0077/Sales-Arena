import { redirect } from "next/navigation";

// "My Dashboard" moved into the Admin Panel.
export default function Page() {
  redirect("/admin/performance");
}
