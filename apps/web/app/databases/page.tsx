import { redirect } from "next/navigation";

// Removed in the Space-Console redesign — databases now live inside their space
// (/spaces/[slug]/databases). Old links land on the spaces home.
export default function DatabasesRedirect() {
  redirect("/");
}
