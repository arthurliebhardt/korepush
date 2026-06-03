import { redirect } from "next/navigation";

// Removed in the Space-Console redesign — domains now live inside their space
// (/spaces/[slug]/domains). Old links land on the spaces home.
export default function DomainsRedirect() {
  redirect("/");
}
