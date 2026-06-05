"use client";

import { useState } from "react";
import { ComposeImport } from "@/components/compose-import";

export function ReImportStack({
  spaceSlug,
  stackSlug,
  stackName,
  initialYaml,
}: {
  spaceSlug: string;
  stackSlug: string;
  stackName: string;
  initialYaml: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button className="btn-ghost" onClick={() => setOpen(true)}>
        Re-import compose
      </button>
    );
  }

  return (
    <section className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Re-import compose</h2>
        <button
          className="text-xs text-muted hover:text-foreground"
          onClick={() => setOpen(false)}
        >
          Close
        </button>
      </div>
      <ComposeImport
        spaceSlug={spaceSlug}
        stackSlug={stackSlug}
        stackName={stackName}
        initialYaml={initialYaml}
      />
    </section>
  );
}
