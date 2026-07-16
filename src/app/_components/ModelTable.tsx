import { SOURCES, type ModelBreakdown } from "@/lib/types";
import { fmtTokens, fmtCost } from "@/lib/format";

const SOURCE_LABEL = new Map(SOURCES.map((source) => [source.id, source]));

export function ModelTable({ models }: { models: ModelBreakdown[] }) {
  const top = models.slice(0, 10);
  const maxTokens = Math.max(1, ...top.map((m) => m.tokens));

  if (top.length === 0) {
    return <div className="text-sm text-zinc-500 py-8 text-center">No usage in this range yet.</div>;
  }

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full text-sm num">
        <thead>
          <tr className="text-[11px] uppercase tracking-[0.12em] text-zinc-500 text-left">
            <th className="font-medium pb-3 pr-4">Model</th>
            <th className="font-medium pb-3 pr-4">Source</th>
            <th className="font-medium pb-3 pr-4 text-right">Tokens</th>
            <th className="font-medium pb-3 pr-4 text-right">Cost</th>
            <th className="font-medium pb-3 pr-4 text-right">Sessions</th>
            <th className="font-medium pb-3 w-32">Share</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60">
          {top.map((m) => {
            const pct = (m.tokens / maxTokens) * 100;
            const s = SOURCE_LABEL.get(m.source)!;
            return (
              <tr key={`${m.source}-${m.model}`} className="hover:bg-zinc-800/20 transition-colors">
                <td className="py-2.5 pr-4 font-mono text-[13px] text-zinc-200">{m.model}</td>
                <td className="py-2.5 pr-4">
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium"
                    style={{
                      backgroundColor: `${s.accent}22`,
                      color: s.accentEnd,
                      boxShadow: `inset 0 0 0 1px ${s.accent}4d`,
                    }}
                  >
                    {s.shortLabel}
                  </span>
                </td>
                <td className="py-2.5 pr-4 text-right text-zinc-100">{fmtTokens(m.tokens)}</td>
                <td className="py-2.5 pr-4 text-right text-zinc-100">{fmtCost(m.costUSD)}</td>
                <td className="py-2.5 pr-4 text-right text-zinc-400">{m.sessions}</td>
                <td className="py-2.5">
                  <div className="h-1.5 w-full bg-zinc-800/60 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{
                      width: `${pct}%`,
                      backgroundImage: `linear-gradient(to right, ${s.accent}, ${s.accentEnd})`,
                    }} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
