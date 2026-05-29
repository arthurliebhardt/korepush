import { redirect } from "next/navigation";
import { isSetupComplete } from "@/lib/auth";
import { AuthForm } from "@/components/auth-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await isSetupComplete()) redirect("/login");

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <span className="text-2xl font-bold tracking-tight">kubepush</span>
        </div>
        <AuthForm mode="setup" />
      </div>
    </main>
  );
}
