"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSpaceAction } from "@/app/actions";

export function CreateSpace() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createSpaceAction(name);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setName("");
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        New space
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex items-start gap-2">
      <div>
        <input
          autoFocus
          className="input w-56"
          placeholder="e.g. production"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </div>
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Creating…" : "Create"}
      </button>
      <button
        type="button"
        className="btn-ghost"
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
      >
        Cancel
      </button>
    </form>
  );
}
