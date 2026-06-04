"use client";

import { deleteStackAction } from "@/app/actions";
import { DangerZone } from "@/components/ui/danger-zone";

export function DeleteStack({
  spaceSlug,
  stackSlug,
  stackName,
  memberCount,
}: {
  spaceSlug: string;
  stackSlug: string;
  stackName: string;
  memberCount: number;
}) {
  return (
    <DangerZone
      noun="stack"
      name={stackName}
      confirmValue={stackSlug}
      description={`Deleting this stack permanently removes its ${memberCount} member${memberCount === 1 ? "" : "s"} (apps and databases) and all their data. This cannot be undone.`}
      onConfirm={() => deleteStackAction(spaceSlug, stackSlug)}
      redirectTo={`/spaces/${spaceSlug}/stacks`}
    />
  );
}
