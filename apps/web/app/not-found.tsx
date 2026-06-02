import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="text-sm text-muted">
        This page doesn’t exist, or you don’t have access to it.
      </p>
      <Link href="/" className="btn-primary mt-2">
        Back to spaces
      </Link>
    </div>
  );
}
