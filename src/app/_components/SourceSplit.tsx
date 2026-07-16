import type { SourceMeta, UsageSnapshot } from "@/lib/types";
import { fmtTokens, fmtCost } from "@/lib/format";

type SourceRow = SourceMeta & { tokens: number; costUSD: number; sessions: number; pct: number };

export function SourceSplit({ today, sources }: { today: UsageSnapshot["today"]; sources: SourceMeta[] }) {
  const total = Math.max(1, today.totalTokens);
  const rows: SourceRow[] = sources.map((source) => {
    const usage = today.bySource[source.id];
    return {
      ...source,
      tokens: usage.tokens,
      costUSD: usage.costUSD,
      sessions: usage.sessions,
      pct: (usage.tokens / total) * 100,
    };
  });
  const active = rows.filter((row) => row.tokens > 0).sort((a, b) => b.tokens - a.tokens);
  const ranked = active.length > 0 ? active : rows;
  const visible = ranked.length > 4 ? ranked.slice(0, 3) : ranked.slice(0, 4);
  const remaining = ranked.length > 4 ? ranked.slice(3) : [];
  const displayedIds = new Set(visible.map((row) => row.id));
  const idle = rows.filter((row) => row.tokens === 0 && !displayedIds.has(row.id));
  const other = remaining.length > 0 ? {
    label: `Other ${remaining.length}`,
    tokens: remaining.reduce((sum, row) => sum + row.tokens, 0),
    costUSD: remaining.reduce((sum, row) => sum + row.costUSD, 0),
    sessions: remaining.reduce((sum, row) => sum + row.sessions, 0),
    pct: remaining.reduce((sum, row) => sum + row.pct, 0),
  } : null;

  return (
    <div className="card p-5">
      <div className="text-[11px] uppercase tracking-[0.14em] text-zinc-400 font-medium">
        Today by Source
      </div>
      <div className="mt-4 h-2.5 w-full bg-zinc-800/70 rounded-full overflow-hidden flex">
        {active.map((row) => (
          <div
            key={row.id}
            className="h-full transition-[width] duration-700"
            style={{
              width: `${row.pct}%`,
              backgroundImage: `linear-gradient(to right, ${row.accent}, ${row.accentEnd})`,
            }}
          />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
        {visible.map((row) => (
          <Row key={row.id} label={row.label} tokens={row.tokens} cost={row.costUSD} sessions={row.sessions} dot={row.accent} pct={row.pct} />
        ))}
        {other && <Row label={other.label} tokens={other.tokens} cost={other.costUSD} sessions={other.sessions} dot="#71717a" pct={other.pct} />}
      </div>
      {idle.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-800/50 pt-3">
          <span className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">No activity</span>
          {idle.map((row) => (
            <span key={row.id} className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900/60 px-2 py-1 text-[11px] text-zinc-500">
              <span className="size-1.5 rounded-full opacity-60" style={{ backgroundColor: row.accent }} />
              {row.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  label, tokens, cost, sessions, dot, pct,
}: { label: string; tokens: number; cost: number; sessions: number; dot: string; pct: number }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-xs text-zinc-300">
        <span className="size-2 rounded-full" style={{ background: dot }} />
        {label}
        <span className="ml-auto num text-zinc-500">{pct > 0 && pct < 1 ? "<1" : pct.toFixed(0)}%</span>
      </div>
      <div className="mt-2 num text-xl font-semibold text-zinc-50 tracking-tight">
        {fmtTokens(tokens)}
      </div>
      <div className="mt-0.5 num text-xs text-zinc-400">{fmtCost(cost)} · {sessions} session{sessions === 1 ? "" : "s"}</div>
    </div>
  );
}
