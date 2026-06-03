"use client";

import { deleteAppAction } from "@/app/actions";
import { DangerZone } from "@/components/ui/danger-zone";

export function DeleteApp({
  spaceSlug,
  appSlug,
  appName,
}: {
  spaceSlug: string;
  appSlug: string;
  appName: string;
}) {
  return (
    <DangerZone
      noun="app"
      name={appName}
      confirmValue={appSlug}
      onConfirm={() => deleteAppAction(spaceSlug, appSlug)}
      redirectTo={`/spaces/${spaceSlug}`}
    />
  );
}
