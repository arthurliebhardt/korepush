// Streams instantly on navigation while the force-dynamic page fetches its
// k8s/DB/Prometheus/GitHub data, instead of blocking on a blank screen.
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-5xl flex-1 animate-pulse px-6 py-8">
      <div className="h-4 w-24 rounded bg-foreground/10" />
      <div className="mt-4 mb-6 flex items-center gap-3">
        <div className="h-6 w-44 rounded bg-foreground/10" />
        <div className="h-5 w-16 rounded-full bg-foreground/10" />
      </div>
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card h-16" />
        ))}
      </div>
      <div className="mb-4 h-4 w-16 rounded bg-foreground/10" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card h-16" />
        ))}
      </div>
    </div>
  );
}
