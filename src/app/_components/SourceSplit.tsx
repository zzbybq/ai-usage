import type { UsageSnapshot } from "@/lib/types";
import { fmtTokens, fmtCost } from "@/lib/format";

export function SourceSplit({ today }: { today: UsageSnapshot["today"] }) {
  const total = Math.max(1, today.totalTokens);
  const claude = today.bySource["claude-code"];
  const codex = today.bySource.codex;
  const hermes = today.bySource.hermes;
  const claudePct = (claude.tokens / total) * 100;
  const codexPct = (codex.tokens / total) * 100;
  const hermesPct = (hermes.tokens / total) * 100;

  return (
    <div className="card p-5">
      <div className="text-[11px] uppercase tracking-[0.14em] text-zinc-400 font-medium">
        Today by Source
      </div>
      <div className="mt-4 h-2.5 w-full bg-zinc-800/70 rounded-full overflow-hidden flex">
        <div
          className="h-full bg-gradient-to-r from-[#d97757] to-[#f0a378] transition-[width] duration-700"
          style={{ width: `${claudePct}%` }}
        />
        <div
          className="h-full bg-gradient-to-r from-[#a78bfa] to-[#c4b5fd] transition-[width] duration-700"
          style={{ width: `${codexPct}%` }}
        />
        <div
          className="h-full bg-gradient-to-r from-[#38bdf8] to-[#7dd3fc] transition-[width] duration-700"
          style={{ width: `${hermesPct}%` }}
        />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <Row label="Claude Code" tokens={claude.tokens} cost={claude.costUSD} sessions={claude.sessions} dot="#d97757" pct={claudePct} />
        <Row label="Codex CLI" tokens={codex.tokens} cost={codex.costUSD} sessions={codex.sessions} dot="#a78bfa" pct={codexPct} />
        <Row label="Hermes" tokens={hermes.tokens} cost={hermes.costUSD} sessions={hermes.sessions} dot="#38bdf8" pct={hermesPct} />
      </div>
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
        <span className="ml-auto num text-zinc-500">{pct.toFixed(0)}%</span>
      </div>
      <div className="mt-2 num text-xl font-semibold text-zinc-50 tracking-tight">
        {fmtTokens(tokens)}
      </div>
      <div className="mt-0.5 num text-xs text-zinc-400">{fmtCost(cost)} · {sessions} session{sessions === 1 ? "" : "s"}</div>
    </div>
  );
}
