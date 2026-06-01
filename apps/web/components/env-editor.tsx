"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAppEnvAction } from "@/app/actions";

type Row = {
  id: number;
  key: string;
  value: string;
  secret: boolean;
  existingSecret: boolean; // a secret already stored — blank value keeps it
};

function parseDotenv(text: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  for (let line of text.split("\n")) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out.push({ key, value });
  }
  return out;
}

export function EnvEditor({
  spaceSlug,
  appSlug,
  env,
  secretKeys,
  dbEnvVar = "DATABASE_URL",
}: {
  spaceSlug: string;
  appSlug: string;
  env: Record<string, string>;
  secretKeys: string[];
  dbEnvVar?: string;
}) {
  const router = useRouter();
  const nextId = useRef(Object.keys(env).length + secretKeys.length);

  const [rows, setRows] = useState<Row[]>(() => {
    let i = 0;
    return [
      ...Object.entries(env).map(([key, value]) => ({
        id: i++,
        key,
        value,
        secret: false,
        existingSecret: false,
      })),
      ...secretKeys.map((key) => ({
        id: i++,
        key,
        value: "",
        secret: true,
        existingSecret: true,
      })),
    ];
  });
  const [bulk, setBulk] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function update(id: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setSaved(false);
  }
  function addRow() {
    const id = nextId.current++;
    setRows((rs) => [
      ...rs,
      { id, key: "", value: "", secret: false, existingSecret: false },
    ]);
  }
  function removeRow(id: number) {
    setRows((rs) => rs.filter((r) => r.id !== id));
    setSaved(false);
  }
  function applyBulk() {
    const parsed = parseDotenv(bulk);
    if (parsed.length === 0) return;
    setRows((rs) => {
      const byKey = new Map(rs.map((r) => [r.key, { ...r }]));
      for (const { key, value } of parsed) {
        const existing = byKey.get(key);
        if (existing) {
          existing.value = value;
          existing.existingSecret = false;
        } else {
          byKey.set(key, {
            id: nextId.current++,
            key,
            value,
            secret: false,
            existingSecret: false,
          });
        }
      }
      return [...byKey.values()];
    });
    setBulk("");
    setShowBulk(false);
    setSaved(false);
  }

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await setAppEnvAction(
        spaceSlug,
        appSlug,
        rows
          .filter((r) => r.key.trim())
          .map((r) => ({ key: r.key.trim(), value: r.value, secret: r.secret })),
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Environment variables</span>
        <button
          type="button"
          className="text-xs text-muted hover:text-foreground"
          onClick={() => setShowBulk((v) => !v)}
        >
          {showBulk ? "Close" : "Paste .env"}
        </button>
      </div>

      {showBulk && (
        <div className="space-y-2">
          <textarea
            className="input h-28 font-mono text-xs"
            placeholder={"KEY=value\n# comment\nDATABASE_URL=postgres://…"}
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
          />
          <button type="button" className="btn-ghost text-xs" onClick={applyBulk}>
            Add from .env
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted">No variables yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            // A plain (non-secret) var with a key but an empty value is saved as
            // an explicit "". For the database var that silently overrides the
            // connection string injected on attach, so call it out specifically.
            const blank =
              !r.secret &&
              !r.existingSecret &&
              r.key.trim() !== "" &&
              r.value === "";
            const dbBlank = blank && r.key.trim() === dbEnvVar;
            return (
              <div key={r.id} className="space-y-1">
                <div className="flex items-center gap-2">
                  <input
                    className="input w-1/3 font-mono text-xs"
                    placeholder="KEY"
                    value={r.key}
                    onChange={(e) => update(r.id, { key: e.target.value })}
                  />
                  <input
                    className={`input flex-1 font-mono text-xs ${
                      blank ? "border-warn" : ""
                    }`}
                    type={r.secret ? "password" : "text"}
                    placeholder={
                      r.existingSecret ? "•••••• (unchanged)" : "value"
                    }
                    value={r.value}
                    onChange={(e) => update(r.id, { value: e.target.value })}
                  />
                  <label
                    className="flex items-center gap-1 text-xs text-muted"
                    title="Store as a secret (value kept in a k8s Secret, never in the database or the pod spec)"
                  >
                    <input
                      type="checkbox"
                      checked={r.secret}
                      onChange={(e) =>
                        update(r.id, { secret: e.target.checked })
                      }
                    />
                    secret
                  </label>
                  <button
                    type="button"
                    className="text-muted hover:text-danger"
                    onClick={() => removeRow(r.id)}
                    aria-label="Remove"
                  >
                    ✕
                  </button>
                </div>
                {blank && (
                  <p className="pl-1 text-xs text-warn">
                    {dbBlank
                      ? `Blank value — this overrides the database connection injected when you attach a database, so the app won't connect. Remove this row (or set a value).`
                      : `Blank value — saved as an empty string. Remove the row if you didn't mean to set ${r.key.trim()} empty.`}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button type="button" className="btn-ghost text-xs" onClick={addRow}>
          + Add variable
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={pending}
          onClick={save}
        >
          {pending ? "Saving…" : "Save & restart"}
        </button>
        {saved && <span className="text-xs text-success">Saved — pods rolling.</span>}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      <p className="text-xs text-muted">
        Saving applies env and rolls the pods (no rebuild). Secret values are
        stored in a k8s Secret, never in the database or the Deployment spec.
      </p>
    </div>
  );
}
