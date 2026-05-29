import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getControlPlaneInfo } from "@kubepush/k8s";
import { DomainSettings } from "@/components/domain-settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireUser();

  let hosts: string[] = [];
  let unavailable: string | null = null;
  try {
    ({ hosts } = await getControlPlaneInfo());
  } catch {
    unavailable =
      "Control-plane settings are only available on an in-cluster install " +
      "(the kubepush-system resources aren't reachable from this dev server).";
  }

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
      <Link href="/" className="text-sm text-muted hover:text-foreground">
        ← Spaces
      </Link>

      <div className="mt-4 mb-6">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted">Domain &amp; access for this instance.</p>
      </div>

      {unavailable ? (
        <div className="card text-sm text-muted">{unavailable}</div>
      ) : (
        <DomainSettings hosts={hosts} />
      )}
    </div>
  );
}
