"use client";

import { deleteSpaceAction } from "@/app/actions";
import { DangerZone } from "@/components/ui/danger-zone";

export function DeleteSpace({ slug, name }: { slug: string; name: string }) {
  return (
    <DangerZone
      noun="space"
      name={name}
      confirmValue={slug}
      description="Deleting this space permanently removes its namespace and every app and database inside it."
      onConfirm={() => deleteSpaceAction(slug)}
      redirectTo="/"
    />
  );
}
