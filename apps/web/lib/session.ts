import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, isSetupComplete } from "@/lib/auth";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/** Gate a page: ensure setup is done and a user is signed in. */
export async function requireUser() {
  if (!(await isSetupComplete())) redirect("/setup");
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
