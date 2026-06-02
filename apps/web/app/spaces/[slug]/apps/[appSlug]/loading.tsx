// Closer Suspense boundary than the space loading skeleton, tailored to the app
// detail layout (the heaviest page — ~7 parallel k8s/DB fetches + finalizeBuild).
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-5xl flex-1 animate-pulse px-6 py-8">
      <div className="h-4 w-32 rounded bg-foreground/10" />
      <div className="mt-4 mb-6 flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-6 w-48 rounded bg-foreground/10" />
          <div className="h-3 w-64 rounded bg-foreground/10" />
        </div>
        <div className="h-8 w-24 rounded bg-foreground/10" />
      </div>
      <div className="mb-5 space-y-5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card h-20" />
        ))}
      </div>
      <div className="card h-64" />
    </div>
  );
}
