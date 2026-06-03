import { redirect } from "next/navigation";

// The global cross-space pages were removed in the Space-Console redesign —
// deployments/databases/domains now live inside their space, and ⌘K covers
// cross-space discovery. Old links land on the spaces home.
export default function DeploymentsRedirect() {
  redirect("/");
}
