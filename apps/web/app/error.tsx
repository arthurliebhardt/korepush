"use client";

import { useEffect } from "react";

// Root error boundary: a backend (DB / k8s / Prometheus) failure during render
// lands here instead of Next's default screen. `reset()` re-renders the segment.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted">
        The control plane couldn’t load this page. A backend (database, cluster,
        or metrics) may be temporarily unreachable.
      </p>
      <button className="btn-primary mt-2" onClick={() => reset()}>
        Try again
      </button>
    </div>
  );
}
