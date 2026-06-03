"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LogLine } from "@/components/log-line";
import { toast } from "@/components/ui/toast";

// Shared log surface: a toolbar (filter / wrap / copy / download) over a
// scrollable body that renders lines via <LogLine>. Auto-tails only while pinned
// to the bottom and shows a "jump to latest" affordance when scrolled up.
export function LogViewer({
  lines,
  title,
  live = false,
  filename = "logs.txt",
  height = "h-[26rem]",
}: {
  lines: string[];
  title?: string;
  live?: boolean;
  filename?: string;
  height?: string;
}) {
  const [query, setQuery] = useState("");
  const [wrap, setWrap] = useState(true);
  const [showJump, setShowJump] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? lines.filter((l) => l.toLowerCase().includes(q)) : lines;
  }, [lines, query]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    pinnedRef.current = atBottom;
    setShowJump(!atBottom);
  };

  useEffect(() => {
    if (pinnedRef.current) {
      bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
    }
  }, [filtered]);

  const jumpToBottom = () => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight });
    pinnedRef.current = true;
    setShowJump(false);
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("Logs copied");
    } catch {
      toast.error("Couldn't copy logs");
    }
  };

  const download = () => {
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 rounded-t-lg border border-b-0 border-border bg-bg-subtle px-3 py-2">
        {title && (
          <span className="flex items-center gap-2 text-sm text-muted">
            {live && (
              <span className="size-1.5 animate-pulse rounded-full bg-success" />
            )}
            {title}
          </span>
        )}
        <input
          className="input ml-auto h-7 w-40 py-1 text-xs"
          placeholder="Filter…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="btn-ghost h-7 px-2 py-1 text-xs"
          onClick={() => setWrap((w) => !w)}
          title="Toggle line wrap"
        >
          {wrap ? "No wrap" : "Wrap"}
        </button>
        <button
          className="btn-ghost h-7 px-2 py-1 text-xs"
          onClick={copyAll}
          disabled={lines.length === 0}
        >
          Copy
        </button>
        <button
          className="btn-ghost h-7 px-2 py-1 text-xs"
          onClick={download}
          disabled={lines.length === 0}
        >
          Download
        </button>
      </div>

      <div className="relative">
        <div
          ref={bodyRef}
          onScroll={onScroll}
          className={`${height} overflow-auto rounded-b-lg border border-border bg-background p-4 font-mono text-xs leading-relaxed text-muted-2`}
        >
          {filtered.length === 0 ? (
            <span className="text-muted">
              {lines.length === 0
                ? "Waiting for log output…"
                : "No lines match the filter."}
            </span>
          ) : (
            <div className={wrap ? "" : "w-max min-w-full"}>
              {filtered.map((line, i) => (
                <LogLine key={i} line={line} wrap={wrap} />
              ))}
            </div>
          )}
        </div>
        {showJump && (
          <button
            onClick={jumpToBottom}
            className="surface-overlay absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 text-xs text-foreground"
          >
            ↓ Jump to latest
          </button>
        )}
      </div>
    </div>
  );
}
