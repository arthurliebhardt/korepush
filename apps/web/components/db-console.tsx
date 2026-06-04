"use client";

import { useState, useTransition } from "react";
import { runDatabaseQueryAction, type QueryResult } from "@/app/actions";

// SQL console — runs owner-supplied SQL against THIS database via the server
// action. It only ever knows (spaceSlug, dbSlug); the connection URI stays
// server-side. Results are capped at 1000 rows by the backend.
export function DbConsole({
  spaceSlug,
  dbSlug,
}: {
  spaceSlug: string;
  dbSlug: string;
}) {
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    const q = sql.trim();
    if (!q || pending) return;
    startTransition(async () => {
      setResult(await runDatabaseQueryAction(spaceSlug, dbSlug, q));
    });
  }

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="text-sm font-medium">Query console</h2>
        <p className="mt-1 text-xs text-danger">
          Runs SQL directly against this database. Statements can modify or
          delete data — there is no undo.
        </p>
      </div>

      <textarea
        className="input resize-y font-mono text-xs"
        rows={8}
        placeholder="SELECT * FROM ..."
        value={sql}
        spellCheck={false}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            run();
          }
        }}
      />

      <div className="flex items-center gap-3">
        <button
          className="btn-primary"
          onClick={run}
          disabled={pending || !sql.trim()}
        >
          {pending ? "Running…" : "Run"}
        </button>
        <span className="text-xs text-fg-subtle">⌘↵ to run</span>
      </div>

      {result &&
        (result.ok ? (
          <ResultView res={result} />
        ) : (
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-danger/40 bg-danger/5 p-3 font-mono text-xs text-danger">
            {result.error}
          </pre>
        ))}
    </section>
  );
}

function ResultView({
  res,
}: {
  res: Extract<QueryResult, { ok: true }>;
}) {
  if (res.columns.length === 0) {
    return (
      <p className="text-xs text-success-fg">
        Statement executed · {res.durationMs} ms
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {res.truncated && (
        <p className="text-xs text-warn-fg">
          Showing the first 1000 rows. Add a LIMIT to refine.
        </p>
      )}
      <div className="panel max-h-96 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-surface-2">
            <tr className="border-b border-border text-muted">
              {res.columns.map((c) => (
                <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {res.rows.map((row, i) => (
              <tr key={i} className="border-b border-border-subtle last:border-0">
                {row.map((cell, j) => (
                  <td key={j} className="whitespace-nowrap px-3 py-1.5 font-mono">
                    {fmtCell(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        {res.rowCount} row{res.rowCount === 1 ? "" : "s"} · {res.durationMs} ms
      </p>
    </div>
  );
}

function fmtCell(v: unknown): React.ReactNode {
  if (v === null || v === undefined)
    return <span className="text-fg-faint">NULL</span>;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
