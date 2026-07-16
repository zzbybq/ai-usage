"use client";

import { useEffect, useState } from "react";
import { Check, SlidersHorizontal, X } from "lucide-react";
import type { SourceId, SourceStatus } from "@/lib/types";

type Props = {
  selectedCount: number;
  onSaved: () => void | Promise<void>;
};

export function SourcePicker({ selectedCount, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/sources", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { sources: SourceStatus[] };
      setSources(body.sources);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  function show() {
    setOpen(true);
    void load();
  }

  function toggle(id: SourceId) {
    setSources((current) => current.map((source) => (
      source.id === id ? { ...source, selected: !source.selected } : source
    )));
  }

  function selectDetected() {
    setSources((current) => current.map((source) => ({
      ...source,
      selected: source.detected,
    })));
  }

  async function save() {
    const selectedSourceIds = sources.filter((source) => source.selected).map((source) => source.id);
    if (selectedSourceIds.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/sources", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedSourceIds }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setOpen(false);
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  const chosen = sources.filter((source) => source.selected).length;

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="card !rounded-lg px-3 py-1.5 text-xs flex items-center gap-1.5 hover:bg-zinc-800/40 transition-colors"
        aria-label="Choose AI coding tools"
      >
        <SlidersHorizontal size={13} className="text-zinc-400" />
        <span className="text-zinc-300">Sources</span>
        <span className="num text-zinc-500">{selectedCount || "—"}</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="source-picker-title"
            className="card flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden !rounded-xl border-zinc-700/70 bg-zinc-950/95 shadow-2xl"
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-800/70 px-5 py-4">
              <div>
                <div className="text-[10px] uppercase tracking-[0.16em] text-violet-300">Dashboard scope</div>
                <h2 id="source-picker-title" className="mt-1 text-base font-semibold text-zinc-50">
                  Choose AI coding tools
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  Your selection applies to every metric and chart.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800/70 hover:text-zinc-200 transition-colors"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="min-h-0 flex-1 px-5 py-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                  Available sources
                </span>
                <button
                  type="button"
                  onClick={selectDetected}
                  disabled={loading}
                  className="text-[11px] text-violet-300 hover:text-violet-200 disabled:opacity-50"
                >
                  Select detected
                </button>
              </div>

              {loading ? (
                <div className="space-y-2">
                  {[0, 1, 2, 3, 4, 5].map((item) => (
                    <div key={item} className="h-14 animate-pulse rounded-lg bg-zinc-900/70" />
                  ))}
                </div>
              ) : (
                <div
                  className="scrollbar-thin grid max-h-[min(350px,42dvh)] grid-cols-1 gap-2 overflow-y-scroll overscroll-contain pr-2 outline-none focus-visible:ring-1 focus-visible:ring-violet-400/50"
                  tabIndex={0}
                  aria-label="AI coding tool sources"
                >
                  {sources.map((source) => (
                    <button
                      type="button"
                      key={source.id}
                      onClick={() => toggle(source.id)}
                      className={`w-full rounded-lg border px-3.5 py-3 text-left transition-colors ${
                        source.selected
                          ? "border-zinc-700 bg-zinc-900/75"
                          : "border-zinc-800/70 bg-zinc-950/30 hover:bg-zinc-900/45"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="flex size-5 shrink-0 items-center justify-center rounded-md border"
                          style={{
                            borderColor: source.selected ? source.accent : "#3f3f46",
                            backgroundColor: source.selected ? `${source.accent}22` : "transparent",
                            color: source.accentEnd,
                          }}
                        >
                          {source.selected && <Check size={13} strokeWidth={2.5} />}
                        </span>
                        <span className="size-2 rounded-full" style={{ backgroundColor: source.accent }} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-zinc-200">{source.label}</span>
                          <span className="mt-0.5 block text-[11px] text-zinc-500">
                            {source.detected ? "Usage store available" : "No local usage found"}
                          </span>
                        </span>
                        <span className={`text-[10px] uppercase tracking-wider ${
                          source.detected ? "text-emerald-300" : "text-zinc-600"
                        }`}>
                          {source.detected ? "Detected" : "Not detected"}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {error && <div className="mt-3 text-xs text-rose-300">Failed to update: {error}</div>}
            </div>

            <div className="flex shrink-0 items-center justify-between border-t border-zinc-800/70 px-5 py-4">
              <span className="text-xs text-zinc-500"><span className="num text-zinc-300">{chosen}</span> selected</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3.5 py-2 text-xs text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={chosen === 0 || saving || loading}
                  className="rounded-lg bg-zinc-100 px-4 py-2 text-xs font-medium text-zinc-950 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {saving ? "Saving…" : "Apply"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
