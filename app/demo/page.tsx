import { redirect } from "next/navigation";

// The demo simulator moved into Admin → Live Arena Controls.
export default function Page() {
  redirect("/admin/arena");
}
