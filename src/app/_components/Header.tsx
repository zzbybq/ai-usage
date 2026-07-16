"use client";

import { Activity, RefreshCw } from "lucide-react";
import { fmtRelative } from "@/lib/format";
import { clsx } from "clsx";
import { SourcePicker } from "./SourcePicker";

type Props = {
  range: 7 | 30 | 90;
  setRange: (r: 7 | 30 | 90) => void;
  metric: "tokens" | "cost";
  setMetric: (m: "tokens" | "cost") => void;
  generatedAt?: string;
  loading: boolean;
  onRefresh: () => void;
  sourceCount: number;
  onSourcesChanged: () => void | Promise<void>;
};

export function Header({ range, setRange, metric, setMetric, generatedAt, loading, onRefresh, sourceCount, onSourcesChanged }: Props) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 pb-2">
      <div className="flex items-center gap-3">
        <div className="relative">
          <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-[#d97757] to-[#a78bfa] opacity-50 blur-md" />
          <div className="relative size-10 rounded-xl bg-zinc-900 ring-1 ring-zinc-700 flex items-center justify-center">
            <Activity size={18} className="text-zinc-100" />
          </div>
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-50">AI Usage</h1>
          <p className="text-xs text-zinc-500 flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-400 live-dot" />
            Local-first · updated {generatedAt ? fmtRelative(generatedAt) : "—"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <SourcePicker selectedCount={sourceCount} onSaved={onSourcesChanged} />
        <Segmented
          value={metric}
          options={[
            { v: "tokens", label: "Tokens" },
            { v: "cost", label: "Cost" },
          ]}
          onChange={(v) => setMetric(v as "tokens" | "cost")}
        />
        <Segmented
          value={String(range)}
          options={[
            { v: "7", label: "7d" },
            { v: "30", label: "30d" },
            { v: "90", label: "90d" },
          ]}
          onChange={(v) => setRange(Number(v) as 7 | 30 | 90)}
        />
        <button
          onClick={onRefresh}
          disabled={loading}
          className="card !rounded-lg px-3 py-1.5 text-xs flex items-center gap-1.5 hover:bg-zinc-800/40 transition-colors disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          <span className="text-zinc-300">Refresh</span>
        </button>
      </div>
    </header>
  );
}

function Segmented({
  value, options, onChange,
}: { value: string; options: { v: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="card !rounded-lg !p-0.5 flex">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={clsx(
            "px-3 py-1 text-xs rounded-md transition-colors",
            value === o.v
              ? "bg-zinc-800/80 text-zinc-50 shadow-sm ring-1 ring-zinc-700/80"
              : "text-zinc-400 hover:text-zinc-200"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
