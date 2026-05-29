"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAppAction } from "@/app/actions";

export function CreateApp({ spaceSlug }: { spaceSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  const [port, setPort] = useState("80");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createAppAction({
        spaceSlug,
        name,
        image,
        port: Number(port) || 80,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setName("");
      setImage("");
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        Deploy app
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Name</label>
          <input
            autoFocus
            className="input"
            placeholder="web"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Image</label>
          <input
            className="input"
            placeholder="nginx:alpine"
            value={image}
            onChange={(e) => setImage(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Container port</label>
          <input
            className="input"
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
        </div>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Deploying…" : "Deploy"}
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
      </div>
    </form>
  );
}
